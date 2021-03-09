# Lamden NodeJs Block Grabber

A simple script to sync blocks to a local server.

## Install BlockGrabber
- `git clone https://github.com/Lamden/lamden-block-grabber.git`
- `cd lamden-block-grabber`
- `npm install`

## Configure Env
Create an environment file at the root of the project.  The block grabber will read this file on each restart.
- `nano .env`

Below are the default values that are used if the entry is absent from the .env file.
- DEBUG_ON=false
  - possible values: `true` or blank
- RE_PARSE_BLOCKS=no
  - possible values: `yes` or blank
- NETWORK=testnet
  - possible values: `testnet` or `mainnet`
- DBUSER=null
- DBPWD=null
- DBURL=127.0.0.1
- DBPORT=27017
- DBNAME={NETWORK}-blockinfo
  - possible values: `any`
- START_AT_BLOCK_NUMBER=0
  - possible values: `any number below the network's current block number`
- MASTERNODE_URL=`Looks up the value of {NETWORK} in known masternode urls for 'testnet' and 'mainnet'`


## Install PM2
- `npm install pm2 -g`

## Start app with PM2
- `pm2 start app.js --name lamden-block-grabber`

## start if stopped
- `pm2 start lamden-block-grabber`

## stop if started
- `pm2 stop lamden-block-grabber`

## restart
If you made changes to `.env` you can restart the app to pickup the new changes
- `pm2 restart lamden-block-grabber`

## monitor output (if DEBUG_ON)
- `pm2 monit`


# Reprocess Blocks
If you want to change the way the block-grabber parses the blocks you can do so and then add `RE_PARSE_BLOCKS=yes` to the `.env` file.
When you run `pm2 restart lamden-block-grabber` the DB will wipe all tables *except for BLOCKS*. It will then start at `START_AT_BLOCK_NUMBER`, using the RAW block data from the saved blocks to rebuild the other databases.  This is a much faster way to rebuild the DB as it doesn't have to get the blocks from the masternode as it already has the block data in BLOCKS.rawBlock.


# DANGER ZONE
## WIPE database entirely
*CAUTION* this option should almost *NEVER* be required.

It takes a long time to get all the block data from a masternode due to rate limiting.  If you use `WIP=yes` to the `.env` file you will wipe all tables INCLUDING the BLOCKS table which will delete all data that was synced from a node.

This will mean you will have to rebuild the block data from the masternode starting at `START_AT_BLOCK_NUMBER` (default is 0).

Generally the only reason to use this is if testnet is reset and you actually need to start getting blocks at 0.  Even then the block-grabber script will detect this on its own and usually wipe automatically.