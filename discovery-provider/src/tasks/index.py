# pylint: disable=C0302
import concurrent.futures
import logging

from sqlalchemy import func
from sqlalchemy.sql.visitors import traverse
from src.app import get_contract_addresses
from src.challenges.challenge_event_bus import ChallengeEventBus
from src.challenges.trending_challenge import should_trending_challenge_update
from src.models import (
    AssociatedWallet,
    Block,
    Follow,
    Playlist,
    Repost,
    Save,
    SkippedTransaction,
    Track,
    TrackRoute,
    URSMContentNode,
    User,
    UserEvents,
)
from src.queries.confirm_indexing_transaction_error import (
    confirm_indexing_transaction_error,
)
from src.queries.get_skipped_transactions import (
    clear_indexing_error,
    get_indexing_error,
    set_indexing_error,
)
from src.tasks.celery_app import celery
from src.tasks.ipld_blacklist import is_blacklisted_ipld
from src.tasks.metadata import track_metadata_format, user_metadata_format
from src.tasks.playlists import playlist_state_update
from src.tasks.social_features import social_feature_state_update
from src.tasks.tracks import track_event_types_lookup, track_state_update
from src.tasks.user_library import user_library_state_update
from src.tasks.user_replica_set import user_replica_set_state_update
from src.tasks.users import user_event_types_lookup, user_state_update
from src.utils import helpers, multihash
from src.utils.indexing_errors import IndexingError
from src.utils.redis_cache import (
    remove_cached_playlist_ids,
    remove_cached_track_ids,
    remove_cached_user_ids,
)
from src.utils.redis_constants import (
    latest_block_hash_redis_key,
    latest_block_redis_key,
    most_recent_indexed_block_hash_redis_key,
    most_recent_indexed_block_redis_key,
)
from src.utils.session_manager import SessionManager

logger = logging.getLogger(__name__)


# ####### HELPER FUNCTIONS ####### #

default_padded_start_hash = (
    "0x0000000000000000000000000000000000000000000000000000000000000000"
)
default_config_start_hash = "0x0"

# Used to update user_replica_set_manager address and skip txs conditionally
zero_address = "0x0000000000000000000000000000000000000000"

# The maximum number of skipped transactions allowed
MAX_SKIPPED_TX = 100


def get_contract_info_if_exists(self, address):
    for contract_name, contract_address in get_contract_addresses().items():
        if update_task.web3.toChecksumAddress(contract_address) == address:
            return (contract_name, contract_address)
    return None


def initialize_blocks_table_if_necessary(db: SessionManager):
    redis = update_task.redis

    target_blockhash = None
    target_blockhash = update_task.shared_config["discprov"]["start_block"]
    target_block = update_task.web3.eth.getBlock(target_blockhash, True)

    with db.scoped_session() as session:
        current_block_query_result = session.query(Block).filter_by(is_current=True)
        if current_block_query_result.count() == 0:
            blocks_query_result = session.query(Block)
            assert (
                blocks_query_result.count() == 0
            ), "Corrupted DB State - Expect single row marked as current"
            block_model = Block(
                blockhash=target_blockhash,
                number=target_block.number,
                parenthash=target_blockhash,
                is_current=True,
            )
            if (
                target_block.number == 0
                or target_blockhash == default_config_start_hash
            ):
                block_model.number = None

            session.add(block_model)
            logger.info(
                f"index.py | initialize_blocks_table_if_necessary | Initializing blocks table - {block_model}"
            )
        else:
            assert (
                current_block_query_result.count() == 1
            ), "Expected SINGLE row marked as current"

            # set the last indexed block in redis
            current_block_result = current_block_query_result.first()
            if current_block_result.number:
                redis.set(
                    most_recent_indexed_block_redis_key, current_block_result.number
                )
            if current_block_result.blockhash:
                redis.set(
                    most_recent_indexed_block_hash_redis_key,
                    current_block_result.blockhash,
                )

    return target_blockhash


def get_latest_block(db: SessionManager):
    latest_block = None
    block_processing_window = int(
        update_task.shared_config["discprov"]["block_processing_window"]
    )
    with db.scoped_session() as session:
        current_block_query = session.query(Block).filter_by(is_current=True)
        assert current_block_query.count() == 1, "Expected SINGLE row marked as current"

        current_block_query_results = current_block_query.all()
        current_block = current_block_query_results[0]
        current_block_number = current_block.number

        if current_block_number == None:
            current_block_number = 0

        target_latest_block_number = current_block_number + block_processing_window

        latest_block_from_chain = update_task.web3.eth.getBlock("latest", True)
        latest_block_number_from_chain = latest_block_from_chain.number

        target_latest_block_number = min(
            target_latest_block_number, latest_block_number_from_chain
        )

        logger.info(
            f"index.py | get_latest_block | current={current_block_number} target={target_latest_block_number}"
        )
        latest_block = update_task.web3.eth.getBlock(target_latest_block_number, True)
    return latest_block


def update_latest_block_redis():
    latest_block_from_chain = update_task.web3.eth.getBlock("latest", True)
    default_indexing_interval_seconds = int(
        update_task.shared_config["discprov"]["block_processing_interval_sec"]
    )
    redis = update_task.redis
    # these keys have a TTL which is the indexing interval
    redis.set(
        latest_block_redis_key,
        latest_block_from_chain.number,
        ex=default_indexing_interval_seconds,
    )
    redis.set(
        latest_block_hash_redis_key,
        latest_block_from_chain.hash.hex(),
        ex=default_indexing_interval_seconds,
    )


def fetch_tx_receipt(transaction):
    web3 = update_task.web3
    tx_hash = web3.toHex(transaction["hash"])
    receipt = web3.eth.getTransactionReceipt(tx_hash)
    response = {}
    response["tx_receipt"] = receipt
    response["tx_hash"] = tx_hash
    return response


def fetch_tx_receipts(self, block_transactions):
    block_tx_with_receipts = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        future_to_tx_receipt = {
            executor.submit(fetch_tx_receipt, tx): tx for tx in block_transactions
        }
        for future in concurrent.futures.as_completed(future_to_tx_receipt):
            tx = future_to_tx_receipt[future]
            try:
                tx_receipt_info = future.result()
                tx_hash = tx_receipt_info["tx_hash"]
                block_tx_with_receipts[tx_hash] = tx_receipt_info["tx_receipt"]
            except Exception as exc:
                logger.error(f"index.py | fetch_tx_receipts {tx} generated {exc}")
    num_processed_txs = len(block_tx_with_receipts.keys())
    num_submitted_txs = len(block_transactions)
    if num_processed_txs != num_submitted_txs:
        raise Exception(
            f"index.py | fetch_tx_receipts Expected ${num_submitted_txs} received {num_processed_txs}"
        )
    return block_tx_with_receipts


def fetch_ipfs_metadata(
    db,
    user_factory_txs,
    track_factory_txs,
    block_number,
    block_hash,
):
    track_abi = update_task.abi_values["TrackFactory"]["abi"]
    track_contract = update_task.web3.eth.contract(
        address=get_contract_addresses()["track_factory"], abi=track_abi
    )

    user_abi = update_task.abi_values["UserFactory"]["abi"]
    user_contract = update_task.web3.eth.contract(
        address=get_contract_addresses()["user_factory"], abi=user_abi
    )

    blacklisted_cids = set()
    cids = set()
    cid_type = {}

    with db.scoped_session() as session:
        for tx_receipt in user_factory_txs:
            txhash = update_task.web3.toHex(tx_receipt.transactionHash)
            user_events_tx = getattr(
                user_contract.events, user_event_types_lookup["update_multihash"]
            )().processReceipt(tx_receipt)
            for entry in user_events_tx:
                metadata_multihash = helpers.multihash_digest_to_cid(
                    entry["args"]._multihashDigest
                )
                if not is_blacklisted_ipld(session, metadata_multihash):
                    cids.add((metadata_multihash, txhash))
                    cid_type[metadata_multihash] = "user"
                else:
                    blacklisted_cids.add(metadata_multihash)

        for tx_receipt in track_factory_txs:
            txhash = update_task.web3.toHex(tx_receipt.transactionHash)
            for event_type in [
                track_event_types_lookup["new_track"],
                track_event_types_lookup["update_track"],
            ]:
                track_events_tx = getattr(
                    track_contract.events, event_type
                )().processReceipt(tx_receipt)
                for entry in track_events_tx:
                    event_args = entry["args"]
                    track_metadata_digest = event_args._multihashDigest.hex()
                    track_metadata_hash_fn = event_args._multihashHashFn
                    buf = multihash.encode(
                        bytes.fromhex(track_metadata_digest), track_metadata_hash_fn
                    )
                    cid = multihash.to_b58_string(buf)
                    if not is_blacklisted_ipld(session, cid):
                        cids.add((cid, txhash))
                        cid_type[cid] = "track"
                    else:
                        blacklisted_cids.add(cid)

    ipfs_metadata = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = []
        futures_map = {}
        for cid, txhash in cids:
            future = executor.submit(
                update_task.ipfs_client.get_metadata,
                cid,
                track_metadata_format
                if cid_type[cid] == "track"
                else user_metadata_format,
                None,
            )
            futures.append(future)
            futures_map[future] = [cid, txhash]

        for future in concurrent.futures.as_completed(futures):
            cid, txhash = futures_map[future]
            try:
                ipfs_metadata[cid] = future.result()
            except Exception as e:
                logger.info("Error in fetch ipfs metadata")
                blockhash = update_task.web3.toHex(block_hash)
                raise IndexingError(
                    "prefetch-cids", block_number, blockhash, txhash, str(e)
                ) from e

    return ipfs_metadata, blacklisted_cids


# During each indexing iteration, check if the address for UserReplicaSetManager
# has been set in the L2 contract registry - if so, update the global contract_addresses object
# This change is to ensure no indexing restart is necessary when UserReplicaSetManager is
# added to the registry.
def update_ursm_address(self):
    web3 = update_task.web3
    shared_config = update_task.shared_config
    abi_values = update_task.abi_values
    user_replica_set_manager_address = get_contract_addresses()[
        "user_replica_set_manager"
    ]
    if user_replica_set_manager_address == zero_address:
        logger.info(
            f"index.py | update_ursm_address, found {user_replica_set_manager_address}"
        )
        registry_address = web3.toChecksumAddress(
            shared_config["contracts"]["registry"]
        )
        registry_instance = web3.eth.contract(
            address=registry_address, abi=abi_values["Registry"]["abi"]
        )
        user_replica_set_manager_address = registry_instance.functions.getContract(
            bytes("UserReplicaSetManager", "utf-8")
        ).call()
        if user_replica_set_manager_address != zero_address:
            get_contract_addresses()[
                "user_replica_set_manager"
            ] = web3.toChecksumAddress(user_replica_set_manager_address)
            logger.info(
                f"index.py | Updated user_replica_set_manager_address={user_replica_set_manager_address}"
            )


def save_and_get_skip_tx_hash(session, redis):
    """Fetch if there is a tx_hash to be skipped because of continuous errors"""
    indexing_error = get_indexing_error(redis)
    if (
        isinstance(indexing_error, dict)
        and "has_consensus" in indexing_error
        and indexing_error["has_consensus"]
    ):
        num_skipped_tx = session.query(func.count(SkippedTransaction.id)).scalar()
        if num_skipped_tx >= MAX_SKIPPED_TX:
            return None
        skipped_tx = SkippedTransaction(
            blocknumber=indexing_error["blocknumber"],
            blockhash=indexing_error["blockhash"],
            txhash=indexing_error["txhash"],
        )
        session.add(skipped_tx)
        return indexing_error["txhash"]
    return None


def index_blocks(self, db, blocks_list):
    web3 = update_task.web3
    redis = update_task.redis

    num_blocks = len(blocks_list)
    block_order_range = range(len(blocks_list) - 1, -1, -1)
    latest_block_timestamp = None
    for i in block_order_range:
        update_ursm_address(self)
        block = blocks_list[i]
        block_index = num_blocks - i
        block_number = block.number
        block_hash = block.hash
        block_timestamp = block.timestamp
        latest_block_timestamp = block_timestamp
        logger.info(
            f"index.py | index_blocks | {self.request.id} | block {block.number} - {block_index}/{num_blocks}"
        )
        challenge_bus: ChallengeEventBus = update_task.challenge_event_bus
        with db.scoped_session() as session, challenge_bus.use_scoped_dispatch_queue():
            current_block_query = session.query(Block).filter_by(is_current=True)

            # Without this check we may end up duplicating an insert operation
            block_model = Block(
                blockhash=web3.toHex(block.hash),
                parenthash=web3.toHex(block.parentHash),
                number=block.number,
                is_current=True,
            )

            # Update blocks table after
            assert (
                current_block_query.count() == 1
            ), "Expected single row marked as current"

            previous_block = current_block_query.first()
            previous_block.is_current = False
            session.add(block_model)

            user_factory_txs = []
            track_factory_txs = []
            social_feature_factory_txs = []
            playlist_factory_txs = []
            user_library_factory_txs = []
            user_replica_set_manager_txs = []

            tx_receipt_dict = fetch_tx_receipts(self, block.transactions)

            # Sort transactions by hash
            sorted_txs = sorted(block.transactions, key=lambda entry: entry["hash"])

            skip_tx_hash = save_and_get_skip_tx_hash(session, redis)
            # Parse tx events in each block
            for tx in sorted_txs:
                tx_hash = web3.toHex(tx["hash"])
                tx_target_contract_address = tx["to"]
                tx_receipt = tx_receipt_dict[tx_hash]

                # Skip in case a transaction targets zero address
                if tx_target_contract_address == zero_address:
                    logger.info(
                        f"index.py | Skipping tx {tx_hash} targeting {tx_target_contract_address}"
                    )
                    continue

                if skip_tx_hash == "commit":
                    # The whole block is worth skipping because we failed at the database commit
                    logger.info(f"index.py | Skipping all txs in block {block.hash}")
                    break

                if skip_tx_hash is not None and skip_tx_hash == tx_hash:
                    logger.info(f"index.py | Skipping tx {tx_hash}")
                    continue

                # Handle user operations
                if (
                    tx_target_contract_address
                    == get_contract_addresses()["user_factory"]
                ):
                    logger.info(
                        f"index.py | UserFactory contract addr: {tx_target_contract_address}"
                        f" tx from block - {tx}, receipt - {tx_receipt}, adding to user_factory_txs to process in bulk"
                    )
                    user_factory_txs.append(tx_receipt)

                # Handle track operations
                if (
                    tx_target_contract_address
                    == get_contract_addresses()["track_factory"]
                ):
                    logger.info(
                        f"index.py | TrackFactory contract addr: {tx_target_contract_address}"
                        f" tx from block - {tx}, receipt - {tx_receipt}"
                    )
                    # Track state operations
                    track_factory_txs.append(tx_receipt)

                # Handle social operations
                if (
                    tx_target_contract_address
                    == get_contract_addresses()["social_feature_factory"]
                ):
                    logger.info(
                        f"index.py | Social feature contract addr: {tx_target_contract_address}"
                        f"tx from block - {tx}, receipt - {tx_receipt}"
                    )
                    social_feature_factory_txs.append(tx_receipt)

                # Handle repost operations
                if (
                    tx_target_contract_address
                    == get_contract_addresses()["playlist_factory"]
                ):
                    logger.info(
                        f"index.py | Playlist contract addr: {tx_target_contract_address}"
                        f"tx from block - {tx}, receipt - {tx_receipt}"
                    )
                    playlist_factory_txs.append(tx_receipt)

                # Handle User Library operations
                if (
                    tx_target_contract_address
                    == get_contract_addresses()["user_library_factory"]
                ):
                    logger.info(
                        f"index.py | User Library contract addr: {tx_target_contract_address}"
                        f"tx from block - {tx}, receipt - {tx_receipt}"
                    )
                    user_library_factory_txs.append(tx_receipt)

                # Handle UserReplicaSetManager operations
                if (
                    tx_target_contract_address
                    == get_contract_addresses()["user_replica_set_manager"]
                ):
                    logger.info(
                        f"index.py | User Replica Set Manager contract addr: {tx_target_contract_address}"
                        f"tx from block - {tx}, receipt - {tx_receipt}"
                    )
                    user_replica_set_manager_txs.append(tx_receipt)

            # pre-fetch cids asynchronously to not have it block in user_state_update
            # and track_state_update
            try:
                ipfs_metadata, blacklisted_cids = fetch_ipfs_metadata(
                    db,
                    user_factory_txs,
                    track_factory_txs,
                    block_number,
                    block_hash,
                )
            except IndexingError as err:
                logger.info(
                    f"index.py | Error in the indexing task at"
                    f" block={err.blocknumber} and hash={err.txhash}"
                )
                set_indexing_error(
                    redis, err.blocknumber, err.blockhash, err.txhash, err.message
                )
                confirm_indexing_transaction_error(
                    redis, err.blocknumber, err.blockhash, err.txhash, err.message
                )
                raise err

            try:
                # bulk process operations once all tx's for block have been parsed
                total_user_changes, user_ids = user_state_update(
                    self,
                    update_task,
                    session,
                    ipfs_metadata,
                    blacklisted_cids,
                    user_factory_txs,
                    block_number,
                    block_timestamp,
                    block_hash,
                )
                user_state_changed = total_user_changes > 0
                logger.info(
                    f"index.py | user_state_update completed"
                    f" user_state_changed={user_state_changed} for block={block_number}"
                )

                total_track_changes, track_ids = track_state_update(
                    self,
                    update_task,
                    session,
                    blacklisted_cids,
                    ipfs_metadata,
                    track_factory_txs,
                    block_number,
                    block_timestamp,
                    block_hash,
                )
                track_state_changed = total_track_changes > 0
                logger.info(
                    f"index.py | track_state_update completed"
                    f" track_state_changed={track_state_changed} for block={block_number}"
                )

                social_feature_state_changed = (  # pylint: disable=W0612
                    social_feature_state_update(
                        self,
                        update_task,
                        session,
                        social_feature_factory_txs,
                        block_number,
                        block_timestamp,
                        block_hash,
                    )
                    > 0
                )
                logger.info(
                    f"index.py | social_feature_state_update completed"
                    f" social_feature_state_changed={social_feature_state_changed} for block={block_number}"
                )

                # Index UserReplicaSet changes
                (
                    total_user_replica_set_changes,
                    replica_user_ids,
                ) = user_replica_set_state_update(
                    self,
                    update_task,
                    session,
                    user_replica_set_manager_txs,
                    block_number,
                    block_timestamp,
                    block_hash,
                    redis,
                )
                user_replica_set_state_changed = total_user_replica_set_changes > 0
                logger.info(
                    f"index.py | user_replica_set_state_update completed"
                    f" user_replica_set_state_changed={user_replica_set_state_changed} for block={block_number}"
                )

                # Playlist state operations processed in bulk
                total_playlist_changes, playlist_ids = playlist_state_update(
                    self,
                    update_task,
                    session,
                    playlist_factory_txs,
                    block_number,
                    block_timestamp,
                    block_hash,
                )
                playlist_state_changed = total_playlist_changes > 0
                logger.info(
                    f"index.py | playlist_state_update completed"
                    f" playlist_state_changed={playlist_state_changed} for block={block_number}"
                )

                user_library_state_changed = (
                    user_library_state_update(  # pylint: disable=W0612
                        self,
                        update_task,
                        session,
                        user_library_factory_txs,
                        block_number,
                        block_timestamp,
                        block_hash,
                    )
                )
                logger.info(
                    f"index.py | user_library_state_update completed"
                    f" user_library_state_changed={user_library_state_changed} for block={block_number}"
                )

                track_lexeme_state_changed = user_state_changed or track_state_changed
                try:
                    session.commit()
                except Exception as e:
                    # Use 'commit' as the tx hash here.
                    # We're at a point where the whole block can't be added to the database, so
                    # we should skip it in favor of making progress
                    blockhash = update_task.web3.toHex(block_hash)
                    raise IndexingError(
                        "session.commit", block_number, blockhash, "commit", str(e)
                    ) from e
                logger.info(
                    f"index.py | session commmited to db for block=${block_number}"
                )
                if skip_tx_hash:
                    clear_indexing_error(redis)
                if user_state_changed:
                    if user_ids:
                        remove_cached_user_ids(redis, user_ids)
                if user_replica_set_state_changed:
                    if replica_user_ids:
                        remove_cached_user_ids(redis, replica_user_ids)
                if track_lexeme_state_changed:
                    if track_ids:
                        remove_cached_track_ids(redis, track_ids)
                if playlist_state_changed:
                    if playlist_ids:
                        remove_cached_playlist_ids(redis, playlist_ids)
                logger.info(
                    f"index.py | redis cache clean operations complete for block=${block_number}"
                )
            except IndexingError as err:
                logger.info(
                    f"index.py | Error in the indexing task at"
                    f" block={err.blocknumber} and hash={err.txhash}"
                )
                set_indexing_error(
                    redis, err.blocknumber, err.blockhash, err.txhash, err.message
                )
                confirm_indexing_transaction_error(
                    redis, err.blocknumber, err.blockhash, err.txhash, err.message
                )
                raise err
        try:
            # Check the last block's timestamp for updating the trending challenge
            [should_update, date] = should_trending_challenge_update(
                session, latest_block_timestamp
            )
            if should_update:
                celery.send_task("calculate_trending_challenges", kwargs={"date": date})
        except Exception as e:
            # Do not throw error, as this should not stop indexing
            logger.error(
                f"index.py | Error in calling update trending challenge {e}",
                exc_info=True,
            )

        # add the block number of the most recently processed block to redis
        redis.set(most_recent_indexed_block_redis_key, block.number)
        redis.set(most_recent_indexed_block_hash_redis_key, block.hash.hex())
        logger.info(
            f"index.py | update most recently processed block complete for block=${block_number}"
        )

    if num_blocks > 0:
        logger.warning(f"index.py | index_blocks | Indexed {num_blocks} blocks")

def revert_saves(self, session, revert_save_entries):
    for save_to_revert in revert_save_entries:
        save_item_id = save_to_revert.save_item_id
        save_user_id = save_to_revert.user_id
        save_type = save_to_revert.save_type
        previous_save_entry = (
            session.query(Save)
            .filter(Save.user_id == save_user_id)
            .filter(Save.save_item_id == save_item_id)
            .filter(Save.save_type == save_type)
            .order_by(Save.blocknumber.desc())
            .first()
        )
        if previous_save_entry:
            previous_save_entry.is_current = True
        # Remove outdated save item entry
        logger.info(f"index.py | {self.request.id} | Reverting repost {save_to_revert}")
        session.delete(save_to_revert)

def revert_reposts(self, session, revert_repost_entries):
    for repost_to_revert in revert_repost_entries:
        repost_user_id = repost_to_revert.user_id
        repost_item_id = repost_to_revert.repost_item_id
        repost_type = repost_to_revert.repost_type
        previous_repost_entry = (
            session.query(Repost)
            .filter(Repost.user_id == repost_user_id)
            .filter(Repost.repost_item_id == repost_item_id)
            .filter(Repost.repost_type == repost_type)
            .order_by(Repost.blocknumber.desc())
            .first()
        )
        # Update prev repost row (is_delete) to is_current == True
        if previous_repost_entry:
            previous_repost_entry.is_current = True
        # Remove outdated repost entry
        logger.info(f"index.py | {self.request.id} | Reverting repost {repost_to_revert}")
        session.delete(repost_to_revert)

def revert_follows(self, session, revert_follow_entries):
    for follow_to_revert in revert_follow_entries:
        previous_follow_entry = (
            session.query(Follow)
            .filter(
                Follow.follower_user_id == follow_to_revert.follower_user_id
            )
            .filter(
                Follow.followee_user_id == follow_to_revert.followee_user_id
            )
            .order_by(Follow.blocknumber.desc())
            .first()
        )
        # update prev follow row (is_delete) to is_current = true
        if previous_follow_entry:
            previous_follow_entry.is_current = True
        # remove outdated follow entry
        logger.info(f"index.py | {self.request.id} | Reverting follow {follow_to_revert}")
        session.delete(follow_to_revert)

def revert_playlists(self, session, revert_playlist_entries, revert_block_number):
    for playlist_to_revert in revert_playlist_entries:
        playlist_id = playlist_to_revert.playlist_id
        previous_playlist_entry = (
            session.query(Playlist)
            .filter(Playlist.playlist_id == playlist_id)
            .filter(Playlist.blocknumber < revert_block_number)
            .order_by(Playlist.blocknumber.desc())
            .first()
        )
        if previous_playlist_entry:
            previous_playlist_entry.is_current = True
        # Remove outdated playlist entry
        logger.info(f"index.py | {self.request.id} | Reverting playlist {previous_playlist_entry}")
        session.delete(playlist_to_revert)

def revert_tracks(self, session, revert_track_entries, revert_block_number):
    for track_to_revert in revert_track_entries:
        track_id = track_to_revert.track_id
        previous_track_entry = (
            session.query(Track)
            .filter(Track.track_id == track_id)
            .filter(Track.blocknumber < revert_block_number)
            .order_by(Track.blocknumber.desc())
            .first()
        )
        if previous_track_entry:
            # First element in descending order is new current track item
            previous_track_entry.is_current = True
        # Remove track entries
        logger.info(f"index.py | {self.request.id} | Reverting track {track_to_revert}")
        session.delete(track_to_revert)

def revert_ursm_nodes(self, session, revert_ursm_content_node_entries, revert_block_number):
    for ursm_content_node_to_revert in revert_ursm_content_node_entries:
        cnode_sp_id = ursm_content_node_to_revert.cnode_sp_id
        previous_ursm_content_node_entry = (
            session.query(URSMContentNode)
            .filter(URSMContentNode.cnode_sp_id == cnode_sp_id)
            .filter(URSMContentNode.blocknumber < revert_block_number)
            .order_by(URSMContentNode.blocknumber.desc())
            .first()
        )
        if previous_ursm_content_node_entry:
            previous_ursm_content_node_entry.is_current = True
        # Remove previous ursm Content Node entires
        logger.info(
            f"index.py | {self.request.id} | Reverting URSM content node {ursm_content_node_to_revert}"
        )
        session.delete(ursm_content_node_to_revert)
# transactions are reverted in reverse dependency order (social features --> playlists --> tracks --> users)
def revert_blocks(self, db, revert_blocks_list):
    # TODO: Remove this exception once the unexpected revert scenario has been diagnosed
    num_revert_blocks = len(revert_blocks_list)
    if num_revert_blocks == 0:
        return

    logger.info(f"index.py | {self.request.id} | num_revert_blocks:{num_revert_blocks}")

    if num_revert_blocks > 10000:
        raise Exception("Unexpected revert, >10,0000 blocks")

    if num_revert_blocks > 5000:
        logger.error(f"index.py | {self.request.id} | Revert blocks list > 5000")
        logger.error(revert_blocks_list)
        revert_blocks_list = revert_blocks_list[:5000]
        logger.error(
            f"index.py | {self.request.id} | Sliced revert blocks list {revert_blocks_list}"
        )

    logger.info(f"index.py | {self.request.id} | Reverting {num_revert_blocks} blocks")
    logger.info(revert_blocks_list)

    with db.scoped_session() as session:

        rebuild_playlist_index = False
        rebuild_track_index = False
        rebuild_user_index = False

        for revert_block in revert_blocks_list:
            # Cache relevant information about current block
            revert_hash = revert_block.blockhash
            revert_block_number = revert_block.number
            logger.info(f"index.py | {self.request.id} | Reverting {revert_block_number}")
            parent_hash = revert_block.parenthash

            # Special case for default start block value of 0x0 / 0x0...0
            if revert_block.parenthash == default_padded_start_hash:
                parent_hash = default_config_start_hash

            # Update newly current block row and outdated row (indicated by current block's parent hash)
            session.query(Block).filter(Block.blockhash == revert_hash).update(
                {"is_current": False}
            )
            session.query(Block).filter(Block.blockhash == parent_hash).update(
                {"is_current": True}
            )

            # aggregate all transactions in current block
            revert_save_entries = (
                session.query(Save).filter(Save.blockhash == revert_hash).all()
            )
            revert_repost_entries = (
                session.query(Repost).filter(Repost.blockhash == revert_hash).all()
            )
            revert_follow_entries = (
                session.query(Follow).filter(Follow.blockhash == revert_hash).all()
            )
            revert_playlist_entries = (
                session.query(Playlist).filter(Playlist.blockhash == revert_hash).all()
            )
            revert_track_entries = (
                session.query(Track).filter(Track.blockhash == revert_hash).all()
            )
            revert_user_entries = (
                session.query(User).filter(User.blockhash == revert_hash).all()
            )
            revert_ursm_content_node_entries = (
                session.query(URSMContentNode)
                .filter(URSMContentNode.blockhash == revert_hash)
                .all()
            )
            revert_associated_wallets = (
                session.query(AssociatedWallet)
                .filter(AssociatedWallet.blockhash == revert_hash)
                .all()
            )
            revert_user_events_entries = (
                session.query(UserEvents)
                .filter(UserEvents.blockhash == revert_hash)
                .all()
            )
            revert_track_routes = (
                session.query(TrackRoute)
                .filter(TrackRoute.blockhash == revert_hash)
                .all()
            )
            logger.info(f"index.py | {self.request.id} | Revert - got all query data")

            # Revert all of above transactions
            with concurrent.futures.ThreadPoolExecutor() as executor:
                futures = [
                    executor.submit(revert_saves, self, session, revert_save_entries),
                    executor.submit(revert_reposts, self, session, revert_repost_entries),
                    executor.submit(revert_follows, self, session, revert_follow_entries),
                    executor.submit(revert_playlists, self, session, revert_playlist_entries, revert_block_number),
                    executor.submit(revert_tracks, self, session, revert_track_entries, revert_block_number),
                    executor.submit(revert_ursm_nodes, self, session, revert_ursm_content_node_entries, revert_block_number)
                ]

                for future in concurrent.futures.as_completed(futures):
                    try:
                        # No return value expected here so we just ensure all futures are resolved
                        future.result()
                    except Exception as exc:
                        logger.error(exc)

            # TODO: ASSERT ON IDS GREATER FOR BOTH DATA MODELS
            for user_to_revert in revert_user_entries:
                user_id = user_to_revert.user_id
                previous_user_entry = (
                    session.query(User)
                    .filter(User.user_id == user_id)
                    .filter(User.blocknumber < revert_block_number)
                    .order_by(User.blocknumber.desc())
                    .first()
                )
                if previous_user_entry:
                    # Update previous user row, setting is_current to true
                    previous_user_entry.is_current = True
                # Remove outdated user entries
                logger.info(f"index.py | {self.request.id} | Reverting user {user_to_revert}")
                session.delete(user_to_revert)

            for associated_wallets_to_revert in revert_associated_wallets:
                user_id = associated_wallets_to_revert.user_id
                previous_associated_wallet_entry = (
                    session.query(AssociatedWallet)
                    .filter(AssociatedWallet.user_id == user_id)
                    .filter(AssociatedWallet.blocknumber < revert_block_number)
                    .order_by(AssociatedWallet.blocknumber.desc())
                    .first()
                )
                if previous_associated_wallet_entry:
                    session.query(AssociatedWallet).filter(
                        AssociatedWallet.user_id == user_id
                    ).filter(
                        AssociatedWallet.blocknumber
                        == previous_associated_wallet_entry.blocknumber
                    ).update(
                        {"is_current": True}
                    )
                # Remove outdated associated wallets
                logger.info(f"index.py | {self.request.id} | Reverting associated Wallet {user_id}")
                session.delete(associated_wallets_to_revert)

            revert_user_events(session, revert_user_events_entries, revert_block_number)

            for track_route_to_revert in revert_track_routes:
                track_id = track_route_to_revert.track_id
                previous_track_route_entry = (
                    session.query(TrackRoute)
                    .filter(
                        TrackRoute.track_id == track_id,
                        TrackRoute.blocknumber < revert_block_number,
                    )
                    .order_by(TrackRoute.blocknumber.desc(), TrackRoute.slug.asc())
                    .first()
                )
                if previous_track_route_entry:
                    previous_track_route_entry.is_current = True
                logger.info(f"index.py | {self.request.id} | Reverting track route {track_route_to_revert}")
                session.delete(track_route_to_revert)

            # Remove outdated block entry
            session.query(Block).filter(Block.blockhash == revert_hash).delete()

            rebuild_playlist_index = rebuild_playlist_index or bool(
                revert_playlist_entries
            )
            rebuild_track_index = rebuild_track_index or bool(revert_track_entries)
            rebuild_user_index = rebuild_user_index or bool(revert_user_entries)
    # TODO - if we enable revert, need to set the most_recent_indexed_block_redis_key key in redis


def revert_user_events(session, revert_user_events_entries, revert_block_number):
    for user_events_to_revert in revert_user_events_entries:
        user_id = user_events_to_revert.user_id
        previous_user_events_entry = (
            session.query(UserEvents)
            .filter(UserEvents.user_id == user_id)
            .filter(UserEvents.blocknumber < revert_block_number)
            .order_by(UserEvents.blocknumber.desc())
            .first()
        )
        if previous_user_events_entry:
            session.query(UserEvents).filter(UserEvents.user_id == user_id).filter(
                UserEvents.blocknumber == previous_user_events_entry.blocknumber
            ).update({"is_current": True})
        logger.info(f"Reverting user events: {user_events_to_revert}")
        session.delete(user_events_to_revert)


# ####### CELERY TASKS ####### #
@celery.task(name="update_discovery_provider", bind=True)
def update_task(self):
    # Cache custom task class properties
    # Details regarding custom task context can be found in wiki
    # Custom Task definition can be found in src/app.py
    db = update_task.db
    web3 = update_task.web3
    redis = update_task.redis

    # Update redis cache for health check queries
    # update_latest_block_redis()

    # Define lock acquired boolean
    have_lock = False
    # Define redis lock object
    update_lock = redis.lock("disc_prov_lock", blocking_timeout=25)
    try:
        # Attempt to acquire lock - do not block if unable to acquire
        have_lock = update_lock.acquire(blocking=False)
        if have_lock:
            logger.info(
                f"index.py#custom | {self.request.id} | update_task | Acquired disc_prov_lock"
            )
            initialize_blocks_table_if_necessary(db)

            latest_block = get_latest_block(db)
            

            # Capture block information between latest and target block hash
            index_blocks_list = []

            # Capture outdated block information given current database state
            revert_blocks_list = []

            current_block_result = None

            with db.scoped_session() as session:
                current_block_result = session.query(Block).filter_by(is_current=True).first()
                current_block = current_block_result.number
                
                logger.info("index.py#custom - About to start custom revert logic")
                count = 0
                while current_block > 23200000 and count < 2500:
                    traverse_block = session.query(Block).filter_by(number=current_block).first()
                    revert_blocks_list.append(traverse_block)
                    parent_block = session.query(Block).filter(
                        Block.blockhash == traverse_block.parenthash
                    ).first()
                    current_block = parent_block.number
                    count += 1
                
                session.expunge_all()

            logger.info("index.py#custom - revert list generated")
            # Exit DB scope, revert/index functions will manage their own sessions
            # Perform revert operations
            revert_blocks(self, db, revert_blocks_list)

            # Perform indexing operations
            # index_blocks(self, db, index_blocks_list)
            logger.info(
                f"index.py#custom | update_task | {self.request.id} | Processing complete within session"
            )
        else:
            logger.error(
                f"index.py#custom | update_task | {self.request.id} | Failed to acquire disc_prov_lock"
            )
    except Exception as e:
        logger.error(f"Fatal error in main loop {e}", exc_info=True)
        raise e
    finally:
        if have_lock:
            update_lock.release()
