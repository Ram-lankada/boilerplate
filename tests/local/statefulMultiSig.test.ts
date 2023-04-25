import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
use(chaiAsPromised)

import { StatefulMultiSig } from '../../src/contracts/statefulMultiSig'
import { getDummySigner, getDummyUTXO } from '../utils/helper'
import {
    bsv,
    FixedArray,
    MethodCallOptions,
    PubKey,
    findSig,
    hash160,
    getDummySig,
} from 'scrypt-ts'
import { myPublicKey } from '../utils/privateKey'

describe('Test SmartContract `StatefulMultiSig`', () => {
    const destAddr = hash160(myPublicKey.toHex())

    const privKeys: bsv.PrivateKey[] = []
    const pubKeys: bsv.PublicKey[] = []
    let pubKeysArr: FixedArray<PubKey, typeof StatefulMultiSig.M>
    let validatedArr: FixedArray<boolean, typeof StatefulMultiSig.M>

    before(async () => {
        const _pubKeysArr = []
        const _validatedArr = []
        for (let i = 0; i < StatefulMultiSig.M; i++) {
            const privKey = bsv.PrivateKey.fromRandom()
            const pubKey = privKey.toPublicKey()
            privKeys.push(privKey)
            pubKeys.push(pubKey)
            _pubKeysArr.push(PubKey(pubKey.toHex()))
            _validatedArr.push(false)
        }

        pubKeysArr = _pubKeysArr as FixedArray<
            PubKey,
            typeof StatefulMultiSig.M
        >
        validatedArr = _validatedArr as FixedArray<
            boolean,
            typeof StatefulMultiSig.M
        >

        await StatefulMultiSig.compile()
    })

    it('should pass adding valid sig.', async () => {
        const statefulMultiSig = new StatefulMultiSig(
            destAddr,
            pubKeysArr,
            validatedArr
        )

        const pubKeyIdx = 0

        const signer = getDummySigner(privKeys[pubKeyIdx])
        statefulMultiSig.connect(signer)

        // Construct next contract instance and update flag array.
        const next = statefulMultiSig.next()
        next.validated[pubKeyIdx] = true

        const fromUTXO = getDummyUTXO()

        const { tx: callTx, atInputIndex } = await statefulMultiSig.methods.add(
            (sigResps) => findSig(sigResps, pubKeys[pubKeyIdx]),
            BigInt(pubKeyIdx),
            // Method call options:
            {
                fromUTXO: fromUTXO,
                pubKeyOrAddrToSign: pubKeys[pubKeyIdx],
                next: {
                    instance: next,
                    balance: fromUTXO.satoshis,
                    atOutputIndex: fromUTXO.outputIndex,
                },
            } as MethodCallOptions<StatefulMultiSig>
        )

        const result = callTx.verifyScript(atInputIndex)
        expect(result.success, result.error).to.eq(true)
    })

    it('should pass paying out if threshold reached.', async () => {
        let statefulMultiSig = new StatefulMultiSig(
            destAddr,
            pubKeysArr,
            validatedArr
        )

        let fromUTXO = getDummyUTXO()

        for (let i = 0; i < StatefulMultiSig.N; i++) {
            const pubKeyIdx = i

            const signer = getDummySigner(privKeys[pubKeyIdx])
            statefulMultiSig.connect(signer)

            // Construct next contract instance and update flag array.
            const next = statefulMultiSig.next()
            next.validated[pubKeyIdx] = true

            await statefulMultiSig.methods.add(
                (sigResps) => findSig(sigResps, pubKeys[pubKeyIdx]),
                BigInt(pubKeyIdx),
                // Method call options:
                {
                    fromUTXO: fromUTXO,
                    pubKeyOrAddrToSign: pubKeys[pubKeyIdx],
                    next: {
                        instance: next,
                        balance: fromUTXO.satoshis,
                        atOutputIndex: fromUTXO.outputIndex,
                    },
                } as MethodCallOptions<StatefulMultiSig>
            )

            statefulMultiSig = next
            fromUTXO = statefulMultiSig.utxo
        }

        const signer = getDummySigner()
        statefulMultiSig.connect(signer)

        // Bind tx builder:
        statefulMultiSig.bindTxBuilder('pay', StatefulMultiSig.payTxBuilder)

        const { tx: callTx, atInputIndex } = await statefulMultiSig.methods.pay(
            // Method call options:
            {
                fromUTXO: fromUTXO,
                changeAddress:
                    await statefulMultiSig.signer.getDefaultAddress(),
            } as MethodCallOptions<StatefulMultiSig>
        )

        const result = callTx.verifyScript(atInputIndex)
        expect(result.success, result.error).to.eq(true)
    })

    it('should fail adding invalid sig.', async () => {
        const statefulMultiSig = new StatefulMultiSig(
            destAddr,
            pubKeysArr,
            validatedArr
        )

        const pubKeyIdx = 0

        const randKey = bsv.PrivateKey.fromRandom()
        const signer = getDummySigner(randKey)
        statefulMultiSig.connect(signer)

        // Construct next contract instance and update flag array.
        const next = statefulMultiSig.next()
        next.validated[pubKeyIdx] = true

        const fromUTXO = getDummyUTXO()

        return expect(
            statefulMultiSig.methods.add(
                (sigResps) => findSig(sigResps, randKey.publicKey),
                BigInt(pubKeyIdx),
                // Method call options:
                {
                    fromUTXO: fromUTXO,
                    pubKeyOrAddrToSign: randKey.publicKey,
                    next: {
                        instance: next,
                        balance: fromUTXO.satoshis,
                        atOutputIndex: fromUTXO.outputIndex,
                    },
                } as MethodCallOptions<StatefulMultiSig>
            )
        ).to.be.rejectedWith(/signature check failed/)
    })

    it('should fail pay if threshold not reached', async () => {
        const statefulMultiSig = new StatefulMultiSig(
            destAddr,
            pubKeysArr,
            validatedArr
        )

        const fromUTXO = getDummyUTXO()

        const signer = getDummySigner()
        statefulMultiSig.connect(signer)

        // Bind tx builder:
        statefulMultiSig.bindTxBuilder('pay', StatefulMultiSig.payTxBuilder)

        return expect(
            statefulMultiSig.methods.pay(
                // Method call options:
                {
                    fromUTXO: fromUTXO,
                    changeAddress:
                        await statefulMultiSig.signer.getDefaultAddress(),
                } as MethodCallOptions<StatefulMultiSig>
            )
        ).to.be.rejectedWith(/Not enough valid signatures./)
    })
})
