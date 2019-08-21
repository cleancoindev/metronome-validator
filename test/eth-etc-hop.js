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
const ethers = require('ethers')
const util = require('./testUtil')
const Validator = require('../lib/validator')
require('dotenv').config()

var ethBuyer = process.env.eth_validator_address
var etcBuyer = process.env.etc_validator_address
var chains
var ethChain, etcChain

before(async () => {
  chains = await util.initContracts()
  ethChain = chains.eth
  etcChain = chains.etc
})

describe('Export test. ETH to ETC', () => {
  var metBalance
  var fee = ethers.utils.bigNumberify(1e12)
  var amount = ethers.utils.bigNumberify(1e12)
  var extraData = 'D'

  before(async () => {
    // await util.getMET(ethChain, ethBuyer)
    metBalance = await ethChain.contracts.METToken.methods
      .balanceOf(ethBuyer)
      .call()
    console.log('metBalance', metBalance)
    assert(metBalance > 0, 'Exporter has no MET token balance')
    metBalance = ethers.utils.bigNumberify(metBalance)
  })

  beforeEach(async () => {
  })

  it('Should be able to export from eth', () => {
    return new Promise(async (resolve, reject) => {
      let totalSupplybefore = await ethChain.contracts.METToken.methods
        .totalSupply()
        .call()
      totalSupplybefore = ethers.utils.bigNumberify(totalSupplybefore)
      console.log('totalSupplybefore', totalSupplybefore)
      try {
        await ethChain.contracts.METToken.methods.export(
          ethChain.web3.utils.toHex('ETC'),
          etcChain.contracts.METToken.options.address,
          etcBuyer,
          amount,
          fee,
          ethChain.web3.utils.toHex(extraData)
        ).send({ from: ethBuyer, gasPrice: 20000000000, gas: 500000 })
      } catch (error) {
        console.log('error', error)
        return reject(error)
      }

      let totalSupplyAfter = await ethChain.contracts.METToken.methods.totalSupply().call()
      totalSupplyAfter = ethers.utils.bigNumberify(totalSupplyAfter)
      console.log('totalSupplyAfter', totalSupplyAfter)
      amount = ethers.utils.bigNumberify(ethChain.web3.utils.toHex(amount))
      fee = ethers.utils.bigNumberify(ethChain.web3.utils.toHex(fee))
      assert(totalSupplybefore.sub(totalSupplyAfter).eq(amount.add(fee)),
        'Export from ETH failed'
      )
      resolve()
    })
  })

  it('Should be able to import in etc', () => {
    return new Promise(async (resolve, reject) => {
      var burnSequence = await ethChain.contracts.TokenPorter.methods.burnSequence().call()
      console.log('burnSequence', burnSequence)
      // var etcWsURL = 'ws://ec2-54-172-219-152.compute-1.amazonaws.com:8556'
      // var web3 = new Web3(new Web3.providers.WebsocketProvider(etcWsURL))
      // var contracts = new MetronomeContracts(web3, 'morden')
      var burnHash = await ethChain.contracts.TokenPorter.methods.exportedBurns(burnSequence - 1).call()
      console.log('burnHash', burnHash)
      var filter = { currentBurnHash: burnHash }
      var options = { filter, fromBlock: 3757156, toBlock: 'latest' }
      let importDataObj = await util.prepareImportData(ethChain, options)
      let totalSupplybefore = await etcChain.contracts.METToken.methods
        .totalSupply()
        .call()
      console.log('totalSupplybefore', totalSupplybefore)
      console.log('etcChain.contracts.METToken.options.address', etcChain.contracts.METToken.options.address)
      try {
        await etcChain.contracts.METToken.methods.importMET(
          ethChain.web3.utils.toHex('ETH'),
          importDataObj.destinationChain,
          importDataObj.addresses,
          importDataObj.extraData,
          importDataObj.burnHashes,
          importDataObj.supplyOnAllChains,
          importDataObj.importData,
          importDataObj.root
        ).send({ from: etcBuyer, gasPrice: 20000000000, gas: 500000 })
        let root = await etcChain.contracts.TokenPorter.methods.merkleRoots(importDataObj.burnHashes[1]).call()
        console.log('root', root)
        assert.equal(root, importDataObj.root, 'Import request is failed')
        resolve()
      } catch (error) {
        return reject(error)
      }
    })
  })

  it('Should be able to validate and attest export receipt', () => {
    return new Promise(async (resolve, reject) => {
      var validator = new Validator(chains, etcChain)
      var burnSequence = await ethChain.contracts.TokenPorter.methods.burnSequence().call()
      var burnHash = await ethChain.contracts.TokenPorter.methods.exportedBurns(burnSequence - 1).call()
      var filter = { currentBurnHash: burnHash }
      var options = { filter, fromBlock: 3757156, toBlock: 'latest' }
      var logExportReceipt = await ethChain.contracts.TokenPorter.getPastEvents('LogExportReceipt', options)
      const returnValues = logExportReceipt[0].returnValues
      console.log('returnValues', returnValues)
      let originChain = 'ETH'
      let response = await validator.validateHash(originChain.toLowerCase(), returnValues.currentBurnHash)
      assert(response.hashExist, 'Validations failed')
      let attstBefore = await etcChain.contracts.Validator.methods.attestationCount(returnValues.currentBurnHash).call()
      let balanceBefore = await etcChain.contracts.METToken.methods
        .balanceOf(returnValues.destinationRecipientAddr)
        .call()
      await validator.attestHash(originChain, returnValues)
      let attstAfter = await etcChain.contracts.Validator.methods.attestationCount(returnValues.currentBurnHash).call()
      console.log('attstAfter', attstAfter)
      console.log('attstBefore', attstBefore)
      assert.equal(attstAfter, 1, 'attestation failed')

      let threshold = await etcChain.contracts.Validator.methods.threshold().call()
      if (threshold === '1') {
        let hashClaimed = await etcChain.contracts.Validator.methods.hashClaimed(returnValues.currentBurnHash).call()
        assert(hashClaimed, 'Minting failed after attestation')
        let balanceAfter = await etcChain.contracts.METToken.methods
          .balanceOf(returnValues.destinationRecipientAddr)
          .call()
        balanceAfter = ethers.utils.bigNumberify(balanceAfter)
        balanceBefore = ethers.utils.bigNumberify(balanceBefore)
        assert(balanceAfter.gt(balanceBefore))
      }
      resolve()
    })
  })

  it('Should be able to export from etc', () => {
    return new Promise(async (resolve, reject) => {
      fee = ethers.utils.bigNumberify(1e12)
      amount = ethers.utils.bigNumberify(2e12)
      let totalSupplybefore = await etcChain.contracts.METToken.methods
        .totalSupply()
        .call()
      totalSupplybefore = ethers.utils.bigNumberify(totalSupplybefore)
      metBalance = await etcChain.contracts.METToken.methods
        .balanceOf(etcBuyer)
        .call()
      console.log('metBalance', metBalance)
      console.log('totalSupplybefore', totalSupplybefore)
      try {
        await etcChain.contracts.METToken.methods.export(
          ethChain.web3.utils.toHex('ETH'),
          ethChain.contracts.METToken.options.address,
          ethBuyer,
          amount,
          fee,
          ethChain.web3.utils.toHex(extraData)
        ).send({ from: etcBuyer, gasPrice: 20000000000, gas: 500000 })
      } catch (error) {
        return reject(error)
      }

      let totalSupplyAfter = await etcChain.contracts.METToken.methods.totalSupply().call()
      totalSupplyAfter = ethers.utils.bigNumberify(totalSupplyAfter)
      metBalance = await etcChain.contracts.METToken.methods
        .balanceOf(etcBuyer)
        .call()
      console.log('metBalance', metBalance)
      console.log('totalSupplyAfter', totalSupplyAfter)
      amount = ethers.utils.bigNumberify(ethChain.web3.utils.toHex(amount))
      fee = ethers.utils.bigNumberify(ethChain.web3.utils.toHex(fee))
      assert(totalSupplybefore.sub(totalSupplyAfter).eq(amount.add(fee)),
        'Export from ETC failed'
      )
      resolve()
    })
  })

  it('Should be able to import in eth', () => {
    return new Promise(async (resolve, reject) => {
      var burnSequence = await etcChain.contracts.TokenPorter.methods.burnSequence().call()
      var burnHash = await etcChain.contracts.TokenPorter.methods.exportedBurns(burnSequence - 1).call()
      var filter = { currentBurnHash: burnHash }
      var options = { filter, fromBlock: 3757156, toBlock: 'latest' }
      let importDataObj = await util.prepareImportData(etcChain, options)
      console.log('importDataObj', importDataObj)
      try {
        await ethChain.contracts.METToken.methods.importMET(
          ethChain.web3.utils.toHex('ETC'),
          importDataObj.destinationChain,
          importDataObj.addresses,
          importDataObj.extraData,
          importDataObj.burnHashes,
          importDataObj.supplyOnAllChains,
          importDataObj.importData,
          importDataObj.root
        ).send({ from: ethBuyer, gasPrice: 20000000000, gas: 500000 })
        let root = await ethChain.contracts.TokenPorter.methods.merkleRoots(importDataObj.burnHashes[1]).call()
        assert.equal(root, importDataObj.root, 'Import request is failed')
        resolve()
      } catch (error) {
        return reject(error)
      }
    })
  })

  it('Should be able to validate and attest export receipt', () => {
    return new Promise(async (resolve, reject) => {
      var validator = new Validator(chains, ethChain)
      var burnSequence = await etcChain.contracts.TokenPorter.methods.burnSequence().call()
      var burnHash = await etcChain.contracts.TokenPorter.methods.exportedBurns(burnSequence - 1).call()
      var filter = { currentBurnHash: burnHash }
      var options = { filter, fromBlock: 3757156, toBlock: 'latest' }
      var logExportReceipt = await etcChain.contracts.TokenPorter.getPastEvents('LogExportReceipt', options)
      const returnValues = logExportReceipt[0].returnValues
      let originChain = 'ETC'
      let response = await validator.validateHash(originChain.toLowerCase(), returnValues.currentBurnHash)
      assert(response.hashExist, 'Validations failed')
      let attstBefore = await ethChain.contracts.Validator.methods.attestationCount(returnValues.currentBurnHash).call()
      let balanceBefore = await ethChain.contracts.METToken.methods
        .balanceOf(returnValues.destinationRecipientAddr)
        .call()
      await validator.attestHash(originChain, returnValues)
      let attstAfter = await ethChain.contracts.Validator.methods.attestationCount(returnValues.currentBurnHash).call()
      assert.equal(attstAfter, '1', 'attestation failed')

      let threshold = await ethChain.contracts.Validator.methods.threshold().call()
      if (threshold === '1') {
        let hashClaimed = await ethChain.contracts.Validator.methods.hashClaimed(returnValues.currentBurnHash).call()
        assert(hashClaimed, 'Minting failed after attestation')
        let balanceAfter = await ethChain.contracts.METToken.methods
          .balanceOf(returnValues.destinationRecipientAddr)
          .call()
        balanceAfter = ethers.utils.bigNumberify(balanceAfter)
        balanceBefore = ethers.utils.bigNumberify(balanceBefore)
        assert(balanceAfter.gt(balanceBefore))
      }
      resolve()
    })
  })
})
