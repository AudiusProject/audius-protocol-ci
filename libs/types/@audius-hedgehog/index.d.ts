declare module '@audius/hedgehog' {
  import { IdentityService } from "../../src/services/identity"
  import Wallet from 'ethereumjs-wallet'

  type RecoveryInfo = {
    login: string
    host: string
  }

  export class Hedgehog {
    wallet: Wallet
    getFn: IdentityService["getFn"]
    setAuthFn: IdentityService["setAuthFn"]
    setUserFn: IdentityService["setUserFn"]
    identityService: IdentityService
    constructor(getFn: IdentityService["getFn"], setAuthFn: IdentityService["setAuthFn"], setUserFn: IdentityService["setUserFn"], useLocalStorage: boolean): void
    async login(email: string, password: string): Promise<Wallet>
    async generateRecoveryInfo(): Promise<RecoveryInfo>
    getWallet(): Wallet
    createWalletObj(passwordEntropy: string): Promise<Wallet>
  }

  export class WalletManager {
    static async createAuthLookupKey(email: string, password: string)
    static async decryptCipherTextAndRetrieveWallet(
      password: string, iv: string, cipherText: string
    ): Promise<{walletObj: Wallet, entropy: string}>
    static async getEntropyFromLocalStorage(): Promise<string>
    static setEntropyInLocalStorage(entropy: string): void
  }
}