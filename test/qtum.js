/*
    The MIT License (MIT)

    Copyright 2018 - 2019, Autonomous Software.

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be included
    in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
    SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const assert = require('chai').assert
const _ = require('lodash')
const fs = require('fs')
const ethers = require('ethers')
const util = require('./testUtil')
const validator = require('../lib/validator')
require('dotenv').config()

var ethBuyer = process.env.eth_validator_address
var ethPassword = process.env.eth_validator_password

var ethChain, qChain

async function validateMinting (
  chain,
  recipient,
  expectedTotalSupply,
  expectedBalanceOfRecepient
) {
  let currentTotalSupply = await chain.contracts.metToken.methods
    .totalSupply()
    .call()
  currentTotalSupply = ethers.utils.bigNumberify(
    ethChain.web3.utils.toHex(currentTotalSupply)
  )
  var diff = expectedTotalSupply.sub(currentTotalSupply)
  assert.closeTo(diff.toNumber(), 0, 3, 'Total supply is wrong after import')
  let balanceOfRecepient = await chain.contracts.metToken.methods
    .balanceOf(recipient)
    .call()
  assert.equal(
    balanceOfRecepient,
    expectedBalanceOfRecepient.toString(10),
    'Balance of recepient wrong after import'
  )
}

const getDataForImport = _.memoize(function () {
  return fs.readFileSync('import-data.json').toString()
})

before(async () => {
  const response = await util.initContracts()
  ethChain = response.ETH
  qChain = response.QTUM
})

describe('Export test 1. ETH to QTUM', () => {
  var metBalance
  var receipt = ''
  var fee = ethers.utils.bigNumberify(2e14)
  var amount = ethers.utils.bigNumberify(1e14)
  var extraData = 'D'

  before(async () => {
    await util.getMET(ethChain, ethBuyer)
    metBalance = await ethChain.contracts.metToken.methods
      .balanceOf(ethBuyer)
      .call()
    assert(metBalance > 0, 'Exporter has no MET token balance')
    metBalance = ethers.utils.bigNumberify(metBalance)
  })

  beforeEach(async () => {
    ethChain.web3.eth.personal.unlockAccount(ethBuyer, ethPassword)
  })

  it('Should be able to export from eth', () => {
    return new Promise(async (resolve, reject) => {
      let totalSupplybefore = await ethChain.contracts.metToken.methods
        .totalSupply()
        .call()
      totalSupplybefore = ethers.utils.bigNumberify(totalSupplybefore)
      try {
        console.log('exporting - test 1')
        receipt = await ethChain.contracts.metToken.methods.export(
          ethChain.web3.utils.toHex('qtum'),
          qChain.contracts.metToken.info.address,
          '0xa730b6d440df0c14dd40a17be09f964744d2580a',
          amount,
          fee,
          ethChain.web3.utils.toHex(extraData)
        ).send({ from: ethBuyer })
        console.log('receipt', receipt)
      } catch (error) {
        console.log('error', error)
        return reject(error)
      }

      let totalSupplyAfter = await ethChain.contracts.metToken.methods.totalSupply().call()
      totalSupplyAfter = ethers.utils.bigNumberify(totalSupplyAfter)
      amount = ethers.utils.bigNumberify(ethChain.web3.utils.toHex(amount))
      fee = ethers.utils.bigNumberify(ethChain.web3.utils.toHex(fee))
      assert(totalSupplybefore.sub(totalSupplyAfter).eq(amount.add(fee)),
        'Export from ETH failed'
      )
      resolve()
    })
  })

  it('Should be able to submit import request in qtum', () => {
    return new Promise(async (resolve, reject) => {
      console.log('preparing import data')
      var filter = {}
      var burnHash = '0xa51675480858c4f492752ba63ba3a102da1400baca2c54ae3e6378767b74050f'
      filter = { currentBurnHash: burnHash }
      var options = { filter, fromBlock: '0', toBlock: 'latest' }
      // var options = { filter, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber }
      let importDataObj = await util.prepareImportData(ethChain, options)
      console.log('importDataObj', importDataObj)
      try {
        await qChain.send(qChain.contracts.metToken, 'importMET', [
          ethChain.web3.utils.toHex('ETH'),
          importDataObj.destinationChain,
          importDataObj.addresses,
          importDataObj.extraData,
          importDataObj.burnHashes,
          importDataObj.supplyOnAllChains,
          importDataObj.importData,
          importDataObj.root]
        )
        let root = await qChain.call(qChain.contracts.tokenPorter, 'merkleRoots')
        console.log('root', root)
        assert.equal(root, importDataObj.root, 'Import request is failed')
        resolve()
      } catch (error) {
        return reject(error)
      }
    })
  })

  it('Validator should be able to attest', () => {
    return new Promise(async (resolve, reject) => {
      qChain.contracts.validator.logEmitter({ minconf: 0 })
        .on('attestHash', (event) => {
          console.log('event', event)
          // TODO: assert and resolve
        })
    })
  })
})
