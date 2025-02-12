/* tslint:disable */
/* eslint-disable */
// @ts-nocheck
/**
 * API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
import type { CoverPhoto } from './CoverPhoto';
import {
    CoverPhotoFromJSON,
    CoverPhotoFromJSONTyped,
    CoverPhotoToJSON,
} from './CoverPhoto';
import type { PlaylistLibrary } from './PlaylistLibrary';
import {
    PlaylistLibraryFromJSON,
    PlaylistLibraryFromJSONTyped,
    PlaylistLibraryToJSON,
} from './PlaylistLibrary';
import type { ProfilePicture } from './ProfilePicture';
import {
    ProfilePictureFromJSON,
    ProfilePictureFromJSONTyped,
    ProfilePictureToJSON,
} from './ProfilePicture';

/**
 * 
 * @export
 * @interface UserFull
 */
export interface UserFull {
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    albumCount: number;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    artistPickTrackId?: number;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    bio?: string;
    /**
     * 
     * @type {CoverPhoto}
     * @memberof UserFull
     */
    coverPhoto?: CoverPhoto;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    followeeCount: number;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    followerCount: number;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    doesFollowCurrentUser?: boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    handle: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    id: string;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    isVerified: boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    location?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    name: string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    playlistCount: number;
    /**
     * 
     * @type {ProfilePicture}
     * @memberof UserFull
     */
    profilePicture?: ProfilePicture;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    repostCount: number;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    trackCount: number;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    isDeactivated: boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    ercWallet?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    splWallet: string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    supporterCount: number;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    supportingCount: number;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    balance: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    associatedWalletsBalance: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    totalBalance: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    waudioBalance: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    associatedSolWalletsBalance: string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    blocknumber: number;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    wallet: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    createdAt: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    creatorNodeEndpoint?: string;
    /**
     * 
     * @type {number}
     * @memberof UserFull
     */
    currentUserFolloweeFollowCount: number;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    doesCurrentUserFollow: boolean;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    handleLc: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    updatedAt: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    coverPhotoSizes?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    coverPhotoLegacy?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    profilePictureSizes?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    profilePictureLegacy?: string;
    /**
     * 
     * @type {string}
     * @memberof UserFull
     */
    metadataMultihash?: string;
    /**
     * 
     * @type {boolean}
     * @memberof UserFull
     */
    hasCollectibles: boolean;
    /**
     * 
     * @type {PlaylistLibrary}
     * @memberof UserFull
     */
    playlistLibrary?: PlaylistLibrary;
}

/**
 * Check if a given object implements the UserFull interface.
 */
export function instanceOfUserFull(value: object): boolean {
    let isInstance = true;
    isInstance = isInstance && "albumCount" in value;
    isInstance = isInstance && "followeeCount" in value;
    isInstance = isInstance && "followerCount" in value;
    isInstance = isInstance && "handle" in value;
    isInstance = isInstance && "id" in value;
    isInstance = isInstance && "isVerified" in value;
    isInstance = isInstance && "name" in value;
    isInstance = isInstance && "playlistCount" in value;
    isInstance = isInstance && "repostCount" in value;
    isInstance = isInstance && "trackCount" in value;
    isInstance = isInstance && "isDeactivated" in value;
    isInstance = isInstance && "splWallet" in value;
    isInstance = isInstance && "supporterCount" in value;
    isInstance = isInstance && "supportingCount" in value;
    isInstance = isInstance && "balance" in value;
    isInstance = isInstance && "associatedWalletsBalance" in value;
    isInstance = isInstance && "totalBalance" in value;
    isInstance = isInstance && "waudioBalance" in value;
    isInstance = isInstance && "associatedSolWalletsBalance" in value;
    isInstance = isInstance && "blocknumber" in value;
    isInstance = isInstance && "wallet" in value;
    isInstance = isInstance && "createdAt" in value;
    isInstance = isInstance && "currentUserFolloweeFollowCount" in value;
    isInstance = isInstance && "doesCurrentUserFollow" in value;
    isInstance = isInstance && "handleLc" in value;
    isInstance = isInstance && "updatedAt" in value;
    isInstance = isInstance && "hasCollectibles" in value;

    return isInstance;
}

export function UserFullFromJSON(json: any): UserFull {
    return UserFullFromJSONTyped(json, false);
}

export function UserFullFromJSONTyped(json: any, ignoreDiscriminator: boolean): UserFull {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'albumCount': json['album_count'],
        'artistPickTrackId': !exists(json, 'artist_pick_track_id') ? undefined : json['artist_pick_track_id'],
        'bio': !exists(json, 'bio') ? undefined : json['bio'],
        'coverPhoto': !exists(json, 'cover_photo') ? undefined : CoverPhotoFromJSON(json['cover_photo']),
        'followeeCount': json['followee_count'],
        'followerCount': json['follower_count'],
        'doesFollowCurrentUser': !exists(json, 'does_follow_current_user') ? undefined : json['does_follow_current_user'],
        'handle': json['handle'],
        'id': json['id'],
        'isVerified': json['is_verified'],
        'location': !exists(json, 'location') ? undefined : json['location'],
        'name': json['name'],
        'playlistCount': json['playlist_count'],
        'profilePicture': !exists(json, 'profile_picture') ? undefined : ProfilePictureFromJSON(json['profile_picture']),
        'repostCount': json['repost_count'],
        'trackCount': json['track_count'],
        'isDeactivated': json['is_deactivated'],
        'ercWallet': !exists(json, 'erc_wallet') ? undefined : json['erc_wallet'],
        'splWallet': json['spl_wallet'],
        'supporterCount': json['supporter_count'],
        'supportingCount': json['supporting_count'],
        'balance': json['balance'],
        'associatedWalletsBalance': json['associated_wallets_balance'],
        'totalBalance': json['total_balance'],
        'waudioBalance': json['waudio_balance'],
        'associatedSolWalletsBalance': json['associated_sol_wallets_balance'],
        'blocknumber': json['blocknumber'],
        'wallet': json['wallet'],
        'createdAt': json['created_at'],
        'creatorNodeEndpoint': !exists(json, 'creator_node_endpoint') ? undefined : json['creator_node_endpoint'],
        'currentUserFolloweeFollowCount': json['current_user_followee_follow_count'],
        'doesCurrentUserFollow': json['does_current_user_follow'],
        'handleLc': json['handle_lc'],
        'updatedAt': json['updated_at'],
        'coverPhotoSizes': !exists(json, 'cover_photo_sizes') ? undefined : json['cover_photo_sizes'],
        'coverPhotoLegacy': !exists(json, 'cover_photo_legacy') ? undefined : json['cover_photo_legacy'],
        'profilePictureSizes': !exists(json, 'profile_picture_sizes') ? undefined : json['profile_picture_sizes'],
        'profilePictureLegacy': !exists(json, 'profile_picture_legacy') ? undefined : json['profile_picture_legacy'],
        'metadataMultihash': !exists(json, 'metadata_multihash') ? undefined : json['metadata_multihash'],
        'hasCollectibles': json['has_collectibles'],
        'playlistLibrary': !exists(json, 'playlist_library') ? undefined : PlaylistLibraryFromJSON(json['playlist_library']),
    };
}

export function UserFullToJSON(value?: UserFull | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'album_count': value.albumCount,
        'artist_pick_track_id': value.artistPickTrackId,
        'bio': value.bio,
        'cover_photo': CoverPhotoToJSON(value.coverPhoto),
        'followee_count': value.followeeCount,
        'follower_count': value.followerCount,
        'does_follow_current_user': value.doesFollowCurrentUser,
        'handle': value.handle,
        'id': value.id,
        'is_verified': value.isVerified,
        'location': value.location,
        'name': value.name,
        'playlist_count': value.playlistCount,
        'profile_picture': ProfilePictureToJSON(value.profilePicture),
        'repost_count': value.repostCount,
        'track_count': value.trackCount,
        'is_deactivated': value.isDeactivated,
        'erc_wallet': value.ercWallet,
        'spl_wallet': value.splWallet,
        'supporter_count': value.supporterCount,
        'supporting_count': value.supportingCount,
        'balance': value.balance,
        'associated_wallets_balance': value.associatedWalletsBalance,
        'total_balance': value.totalBalance,
        'waudio_balance': value.waudioBalance,
        'associated_sol_wallets_balance': value.associatedSolWalletsBalance,
        'blocknumber': value.blocknumber,
        'wallet': value.wallet,
        'created_at': value.createdAt,
        'creator_node_endpoint': value.creatorNodeEndpoint,
        'current_user_followee_follow_count': value.currentUserFolloweeFollowCount,
        'does_current_user_follow': value.doesCurrentUserFollow,
        'handle_lc': value.handleLc,
        'updated_at': value.updatedAt,
        'cover_photo_sizes': value.coverPhotoSizes,
        'cover_photo_legacy': value.coverPhotoLegacy,
        'profile_picture_sizes': value.profilePictureSizes,
        'profile_picture_legacy': value.profilePictureLegacy,
        'metadata_multihash': value.metadataMultihash,
        'has_collectibles': value.hasCollectibles,
        'playlist_library': PlaylistLibraryToJSON(value.playlistLibrary),
    };
}

