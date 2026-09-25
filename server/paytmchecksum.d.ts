declare module "paytmchecksum" {
  const PaytmChecksum: {
    generateSignature(body: string, merchantKey: string): Promise<string>;
    verifySignature(
      body: string | Record<string, string>,
      merchantKey: string,
      signature: string,
    ): boolean;
  };
  export default PaytmChecksum;
}
