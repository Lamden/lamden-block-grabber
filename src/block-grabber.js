import {config} from 'dotenv'
config()
import mongoose_models from './mongoose.models.js';
import https from 'https';
import http from 'http';
import mongoose from 'mongoose';
import { isLamdenKey } from './utils.js'

let db = mongoose;
const MASTERNODE_URLS = {
    'testnet': "https://testnet-master-1.lamden.io",
    'mainnet' : "https://masternode-01.lamden.io"
}

/******* MONGO DB CONNECTION INFO **/
const DEBUG_ON = process.env.DEBUG_ON  || false
const NETWORK = process.env.NETWORK || 'testnet'
const DBUSER = process.env.DBUSER || null;
const DBPWD = process.env.DBPWD  || null;
const DBURL = process.env.DBURL || '127.0.0.1'
const DBPORT = process.env.DBPORT || '27017'
const DBNAME = process.env.DBNAME || `${NETWORK}-blockinfo`
const START_AT_BLOCK_NUMBER = process.env.START_AT_BLOCK_NUMBER || 0
const MASTERNODE_URL = process.env.MASTERNODE_URL || MASTERNODE_URLS[NETWORK]

console.log({
    DEBUG_ON, NETWORK, DBUSER, DBPWD, DBURL, DBPORT, DBNAME, START_AT_BLOCK_NUMBER, MASTERNODE_URL
})

//console.log(DBUSER, DBPWD);
let connectionString = `mongodb://${DBURL}:${DBPORT}/${DBNAME}`;

if (DBUSER) {
	connectionString = `mongodb://${DBUSER}:${DBPWD}@${DBURL}:${DBPORT}/${DBNAME}?authSource=admin`;
}


var wipeOnStartup = false;
if (typeof process.env.WIPE !== "undefined") {
	if (process.env.WIPE === "yes") wipeOnStartup = true;
}

var reParseBlocks = false;
if (typeof process.env.RE_PARSE_BLOCKS !== "undefined") {
	if (process.env.RE_PARSE_BLOCKS === "yes") reParseBlocks = true;
}

const databaseLoader = () => {
    let models = mongoose_models

	let currBlockNum = START_AT_BLOCK_NUMBER;
	let checkNextIn = 0;
	let maxCheckCount = 10;
	let alreadyCheckedCount = 0;
	const route_getBlockNum = "/blocks?num=";
	const route_getLastestBlock = "/latest_block";
	let lastestBlockNum = 0;
	let currBatchMax = 0;
	let batchAmount = 25;
	let timerId;

	const wipeDB = async (force = false) => {
		console.log("-----WIPING DATABASE-----");
		if (wipeOnStartup || force){
			await db.models.Blocks.deleteMany({}).then((res) => console.log(res));
			console.log("Blocks DB wiped");
		}
		await db.models.Subblocks.deleteMany({}).then((res) =>
			console.log(res)
		);
		console.log("Subblocks DB wiped");
		await db.models.SubblockSigs.deleteMany({}).then((res) =>
			console.log(res)
		);
		console.log("SubblockSigs DB wiped");
		await db.models.State.deleteMany({}).then((res) => console.log(res));
		console.log("State DB wiped");
		await db.models.Transactions.deleteMany({}).then((res) =>
			console.log(res)
		);
		console.log("Transactions DB wiped");

		currBlockNum = START_AT_BLOCK_NUMBER;

		console.log(`Set currBlockNum = ${START_AT_BLOCK_NUMBER}`);
		timerId = setTimeout(checkForBlocks, 500);
	};

	const sendBlockRequest = (url) => {
		return new Promise((resolve) => {
			let protocol = http;
			if (url.includes("https://")) protocol = https;
			protocol
				.get(url, (resp) => {
					let data = "";
					resp.on("data", (chunk) => {
						data += chunk;
					});
					resp.on("end", () => {
						try {
							// console.log(data);
							resolve(JSON.parse(data));
						} catch (err) {
							console.error("Error: " + err);
							resolve({ error: err.message });
						}
					});
				})
				.on("error", (err) => {
					console.error("Error: " + err.message);
					resolve({ error: err.message });
				});
		});
	};

	const processBlock = async (blockInfo) => {
		if (
			typeof blockInfo.error === "undefined" &&
			typeof blockInfo.number !== "undefined"
		) {
			let hasBlockInDB = false
			let blockNum = blockInfo.number.__fixed__ ? parseInt(blockInfo.number.__fixed__) : blockInfo.number;
			let block = await models.Blocks.findOne({blockNum})
			if (!block){
				console.log("Block doesn't exists, adding new BLOCK model")
				block = new models.Blocks({
					rawBlock: JSON.stringify(blockInfo),
					blockNum,
					hash: blockInfo.hash,
					previous: blockInfo.previous,
					numOfSubBlocks: 0,
					numOfTransactions: 0,
					transactions: JSON.stringify([])
				});
			}else{
				hasBlockInDB = true
				console.log("Block already exists, not adding BLOCK model")
			}

			console.log(
				"processing block " + blockNum + " - ",
				block.hash
			);

			let blockTxList = [];
			if (typeof blockInfo.subblocks !== "undefined") {
				blockInfo.subblocks.forEach((sb) => {
					block.numOfSubBlocks = block.numOfSubBlocks + 1;
					let subblockTxList = [];
					let subblock = new models.Subblocks({
						blockNum,
						inputHash: sb.input_hash,
						merkleLeaves: JSON.stringify(sb.merkle_leaves),
						prevBlockHash: sb.previous,
						signatures: JSON.stringify(sb.signatures),
						subBlockNum: sb.subblock,
						numOfTransactions: 0,
						transactions: JSON.stringify([])
					});

					sb.signatures.forEach((sig) => {
						new models.SubblockSigs({
							blockNum,
							subBlockNum: sb.subblock,
							signature: sig.signature,
							signer: sig.signer
						}).save();
					});
                    // console.log(sb.transactions);
                    sb.transactions.forEach( async (tx) => {
                        sb.numOfTransactions = sb.numOfTransactions + 1;
                        block.numOfTransactions = block.numOfTransactions + 1;
                        blockTxList.push(tx.hash)
                        subblockTxList.push(tx.hash)
                        
                        // store the transaction in the database

                        /* 
                            If you are using this script to grab transactions against a specific smart contract only,
                            then you can filter this logic by checking tx.transaction.payload.contract against the
                            contract name you want.
                        */
                        let transaction = new models.Transactions({
                            hash:  tx.hash,
                            result: tx.result, 
                            stampsUsed: tx.stamps_used,
                            status:   tx.status,
                            transaction:  JSON.stringify(tx.transaction) || undefined, 
                            state: JSON.stringify(tx.state) || undefined,
                            blockNum: blockInfo.number,
                            subBlockNum: sb.subblock,
                            contractName: tx.transaction.payload.contract,
                            functionName: tx.transaction.payload.function,
                            nonce: tx.transaction.payload.nonce,
                            processor: tx.transaction.payload.processor,
                            sender: tx.transaction.payload.sender,
                            stampsSupplied: tx.transaction.payload.stamps_supplied,
                            kwargs: JSON.stringify(tx.transaction.payload.kwargs),
                            timestamp: new Date(tx.transaction.metadata.timestamp * 1000),
                            signature: tx.transaction.metadata.signature,
                            numOfStateChanges: 0
                        })
                        
                        // parse and store the state changes from each transaction in the database
                        if (Array.isArray(tx.state)){
                            tx.state.forEach(s => {
                                transaction.numOfStateChanges = transaction.numOfStateChanges + 1
                                let state = new models.State({
                                    hash:  tx.hash,
                                    txNonce: tx.transaction.payload.nonce,
                                    blockNum: blockInfo.number,
                                    subBlockNum: sb.subblock,
                                    rawKey: s.key,
                                    contractName: s.key.split(":")[0].split(".")[0],
                                    variableName: s.key.split(":")[0].split(".")[1],
                                    key: s.key.split(/:(.+)/)[1],
                                    value: s.value
                                })

                                state.keyIsAddress = isLamdenKey(state.key)
                                state.keyContainsAddress = false
                                let stateKeys = []
                                if (state.key){
                                    state.key.split(":").forEach(k => {
                                        stateKeys.push(k)
                                        if (isLamdenKey(k)) state.keyContainsAddress = true
                                    })
                                }
                                state.keys = JSON.stringify(stateKeys)
                                state.save();
                            })
                        }

                        // determine the stamps costs for each contracts methods and store the min, max, average and stats
                        let stampInfo = await models.Stamps.findOne({contractName: transaction.contractName, functionName: transaction.functionName})
                        if (!stampInfo){
                            new models.Stamps({
                                contractName: transaction.contractName,
                                functionName: transaction.functionName,
                                avg: transaction.stampsUsed,
                                max: transaction.stampsUsed,
                                min: transaction.stampsUsed,
                                numOfTxs: 1
                            }).save()
                        }else{
                            await models.Stamps.updateOne({contractName: transaction.contractName, functionName: transaction.functionName}, {
                                min: transaction.stampsUsed < stampInfo.min ?  transaction.stampsUsed : stampInfo.min,
                                max: transaction.stampsUsed > stampInfo.max ? transaction.stampsUsed : stampInfo.max,
                                avg: Math.ceil((stampInfo.avg + transaction.stampsUsed) / 2 ),
                                numOfTxs: stampInfo.numOfTxs + 1
                            });
                        }

                        transaction.save();
                    })
					subblock.transactions = JSON.stringify(subblockTxList);
					subblock.save();
				});
			}
			block.transactions = JSON.stringify(blockTxList);
			block.save(function(err) {
				if (err) console.log(err);
				console.log("saved " + blockNum);
			});
			if (blockNum === currBatchMax) {
				currBlockNum = currBatchMax;
				timerId = setTimeout(checkForBlocks, 3000);
			}
		}
	};

	const getBlock_MN = (blockNum, timedelay = 0) => {
		return new Promise(resolver => {
			setTimeout(async () => {
				const block_res = await sendBlockRequest(`${MASTERNODE_URL}${route_getBlockNum}${blockNum}`);
				resolver(block_res);
			}, timedelay)
		})
	};

	const getLatestBlock_MN = () => {
		return new Promise((resolve, reject) => {
			const returnRes = async (res) => {
				resolve(res);
			};

			const res = sendBlockRequest(
				`${MASTERNODE_URL}${route_getLastestBlock}`
			);
			returnRes(res);
		});
	};

	const checkForBlocks = async () => {
        if(DEBUG_ON){
            console.log("checking")
        }
		let response = await getLatestBlock_MN();
		
		if (!response.error) {

			lastestBlockNum = response.number;

			if (lastestBlockNum.__fixed__) lastestBlockNum = parseInt(lastestBlockNum.__fixed__)
			if (lastestBlockNum < currBlockNum || wipeOnStartup || reParseBlocks) {
				await wipeDB();
				wipeOnStartup = false;
				reParseBlocks = false;
			} else {
                if (DEBUG_ON){
                    console.log("lastestBlockNum: " + lastestBlockNum);
                    console.log("currBlockNum: " + currBlockNum);
                }
				if (lastestBlockNum === currBlockNum) {
					if (alreadyCheckedCount < maxCheckCount)
						alreadyCheckedCount = alreadyCheckedCount + 1;
					checkNextIn = 200 * alreadyCheckedCount;
					timerId = setTimeout(checkForBlocks, checkNextIn);
				}

				let to_fetch = [];
				if (lastestBlockNum > currBlockNum) {
					currBatchMax = currBlockNum + batchAmount;
					if (currBatchMax > lastestBlockNum)
						currBatchMax = lastestBlockNum;
					if (currBatchMax > batchAmount) currBatchMax + batchAmount;
					let blocksToGetCount = 1
					for (let i = currBlockNum + 1; i <= currBatchMax; i++) {
						let blockInfo = await models.Blocks.findOne({blockNum: i})
						let blockData = null;
						if(blockInfo) {
							blockData = JSON.parse(blockInfo.rawBlock)
						}else{
                            const timedelay = blocksToGetCount * 500;
                            if (DEBUG_ON){
                                console.log("getting block: " + i + " with delay of " + timedelay + "ms");	
                            }

							blockData = getBlock_MN(i, timedelay)
							blocksToGetCount = blocksToGetCount + 1
						}
						to_fetch.push(blockData);
					}

					let to_process = await Promise.all(to_fetch);
					to_process.sort((a, b) => a.number - b.number);
					for (let block of to_process) await processBlock(block);
				}

				if (lastestBlockNum < currBlockNum) {
					await wipeDB(true);
					timerId = setTimeout(checkForBlocks, 10000);
				}
			}
		} else {
			console.log("Could not contact masternode, trying again in 10 seconds");
			timerId = setTimeout(checkForBlocks, 10000);
		}
	};

	models.Blocks.findOne()
		.sort({ blockNum: -1 })
		.then(async (res) => {
			if (res) currBlockNum = res.blockNum ? res.blockNum : 0;
			else currBlockNum = 0;
			timerId = setTimeout(checkForBlocks, 0);
		});
};

export const run = () => {
    db.connect(
        connectionString,
        { useNewUrlParser: true, useUnifiedTopology: true },
        (error) => {
            if (error) {
                console.log(error)
                throw new Error(error)
            }else {
                console.log("connection successful");
                databaseLoader();
            }
        }
    );
};