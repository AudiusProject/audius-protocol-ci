#!/bin/bash

# Audius Discovery Provider / Test
# Runs configured unit test scripts
# NOTE - the ipfs compose files have been moved from discprov to libs.
#   Before running this test locally, bring up ipfs pod with libs/scripts/ipfs.sh

source ./scripts/utilities.sh

if [ ! -f .gitignore ]; then
  echo "Run test script from audius discovery provider root"
  exit
fi

set -e

# initialize virtual environment
# rm -r venv
# python3 -m venv venv
# source venv/bin/activate
pip3 install -r requirements.txt
sleep 5
set +e

# Reset local blockchain for deterministic test results
cd_contracts_repo
npm run ganache-q
npm run ganache
sleep 5
node_modules/.bin/truffle migrate
node_modules/.bin/truffle exec scripts/_contractsLocalSetup.js -run

cd_eth_contracts_repo
npm run ganache-q
npm run ganache
sleep 5
node_modules/.bin/truffle migrate
export audius_eth_contracts_registry=$(node -p "require('./migrations/migration-output.json').registryAddress")
export audius_web3_eth_provider_url=http://localhost:8546

cd_discprov_repo

# Stop dependencies, if present
docker network rm audius_dev
docker-compose \
  -f compose/docker-compose.db.yml \
  -f compose/docker-compose.redis.yml \
  -f compose/docker-compose.ipfs.yml \
  --env-file compose/.test.env \
  stop

docker-compose \
  -f compose/docker-compose.db.yml \
  -f compose/docker-compose.redis.yml \
  -f compose/docker-compose.ipfs.yml \
  --env-file compose/.test.env \
  rm -rf

# Bring up local dependencies - postgres, redis, ipfs
docker network create audius_dev
docker-compose \
  -f compose/docker-compose.db.yml \
  -f compose/docker-compose.redis.yml \
  -f compose/docker-compose.ipfs.yml \
  --env-file compose/.test.env \
  up -d

sleep 5

# Unit tests
pytest src

# Integration tests
pytest tests
