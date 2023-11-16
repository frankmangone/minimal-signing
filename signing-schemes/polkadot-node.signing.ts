import { mnemonicGenerate } from "@polkadot/util-crypto";
import { waitReady } from "@polkadot/wasm-crypto";
import { Keyring } from "@polkadot/keyring";
import { ApiPromise, WsProvider } from "@polkadot/api";
import "dotenv/config";

// Modify as necessary
const API_URL = "ws://127.0.0.1:9944";

export const sign = async () => {
	await waitReady();

	// This is a minimal representation of our decoupled signing process,
	// motivated by the fact that we have custodial wallets. The process is very contrived
	// to represent all the internal communication steps; complexity reduction is not an option.
	//
	// Step 1. Generate a wallet
	// ----------------------------------------------------------------
	const keyring = new Keyring({ type: "sr25519" });
	const mnemonic = mnemonicGenerate();

	const pair = keyring.addFromUri(mnemonic);
	const wallet = pair.toJson();
	const encodedWallet = wallet.encoded;
	const address = wallet.address;
	// This wallet is encrypted and saved to a DB; we'll not reproduce this step.

	// Step 2. Encode a dispatchable call
	// ---------------------------------------------------------------
	const provider = new WsProvider(API_URL);
	const api = await ApiPromise.create({ provider });

	// The particular values here are irrelevant (I think).
	const tx = await api.tx.pogrs.mint(
		1,
		100,
		"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		1000,
		1692434303
	);
	const encodedCall = tx.toHex();
	// The `encodedCall` is passed arround as a hex string, and reaches the signing step as such.

	// Step 3. Sign the encoded call
	// ---------------------------------------------------------------
	// The wallet is loaded from its json representation
	const signer = keyring.addFromJson({
		address,
		meta: {},
		encoding: { content: ["pkcs8", "sr25519"], type: ["none"], version: "3" },
		encoded: encodedWallet,
	});
	signer.unlock(); // No passphrase was used

	const signature = signer.sign(fromHex(encodedCall));
	const encodedSignature = toHex(signature);
	// The `encodedSignature` is passed arround as a hex string, and reaches the publishing step as such.

	// Step 4. Publish the transaction
	// ---------------------------------------------------------------
	// We need to reconstruct the SubmittableExtrinsic
	const submittableExtrinsic = api.tx(encodedCall);

	// Then, we add the signature:
	const payload = await buildPayload(api, submittableExtrinsic, address);
	const decodedSignature = fromHex(encodedSignature);
	submittableExtrinsic.addSignature(address, decodedSignature, payload);

	// Finally, we try submission:
	try {
		const _ = await tx.send();
		console.log({
			message: "Call submitted successfully",
		});
	} catch (err: any) {
		console.error({
			message: "Error sending transaction",
			error: err.message,
		});
	}
};

const buildPayload = async (
	api: ApiPromise,
	tx: any, // SubmittableExtrinsic, actually
	sender: string
): Promise<any> => {
	const lastHeader = await api.rpc.chain.getHeader();
	const blockNumber = api.registry.createType(
		"BlockNumber",
		lastHeader.number.toNumber()
	);
	const method = api.createType("Call", tx);
	const era = api.registry.createType("ExtrinsicEra", {
		current: lastHeader.number.toNumber(),
		period: 64,
	});

	const nonceRaw =
		((await api.query.system.account(sender)) as any)?.nonce || 0;
	const nonce = api.registry.createType("Compact<Index>", nonceRaw);

	return {
		specVersion: api.runtimeVersion.specVersion.toHex(),
		transactionVersion: api.runtimeVersion.transactionVersion.toHex(),
		address: sender,
		blockHash: lastHeader.hash.toHex(),
		blockNumber: blockNumber.toHex(),
		era: era.toHex(),
		genesisHash: api.genesisHash.toHex(),
		method: method.toHex(),
		nonce: nonce.toHex(),
		signedExtensions: [
			"CheckNonZeroSender",
			"CheckSpecVersion",
			"CheckTxVersion",
			"CheckGenesis",
			"CheckMortality",
			"CheckNonce",
			"CheckWeight",
			"ChargeTransactionPayment",
		],
		tip: api.registry.createType("Compact<Balance>", 0).toHex(),
		version: tx.version,
	};
};

const toHex = (bytes: Uint8Array): string => {
	return Buffer.from(bytes).toString("hex");
};

const fromHex = (hex: string): Uint8Array => {
	return Uint8Array.from(Buffer.from(hex, "hex"));
};
