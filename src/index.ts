import { deriveChildSeed, genKeyPairFromSeed } from "skynet-js";

import { loginKey, providerName, providerUrl, uiH, uiW } from "./consts";
import { Provider, SkappInfo } from "./provider";
import type { Interface } from "./provider";
import { popupCenter } from "./utils";

type ConnectedInfo = {
  seed: string,
  identity: string,
};

export class IdentityProvider extends Provider<ConnectedInfo> {
  static providerInterface: Interface = {
    identity: ["string"],
    isLoggedIn: ["bool"],
    login: [],
    logout: [],
  };

  connectedInfo?: ConnectedInfo;

  // ===========
  // Constructor
  // ===========

  constructor() {
    super(IdentityProvider.providerInterface);
  }

  // =========================
  // Required Provider Methods
  // =========================

  protected async clearConnectedInfo(): Promise<void> {
    localStorage.removeItem(loginKey);

    this.connectedInfo = undefined;
  }

  protected async fetchConnectedInfo(): Promise<ConnectedInfo | null> {
    const seed = localStorage.getItem(loginKey);
    if (!seed) {
      return null;
    }

    // Identity should have been set when creating the seed.
    const identity = await this.fetchIdentityUsingSeed(seed);

    const connectedInfo = { seed, identity };
    this.connectedInfo = connectedInfo;
    return connectedInfo;
  }

  /**
   * Saves the seed and identity for the user. If the identity was not provided, we will look it up and return it.
   */
  protected async saveConnectedInfo(connectedInfo: ConnectedInfo): Promise<ConnectedInfo> {
    // Empty identity means the user signed in.
    if (connectedInfo.identity === "") {
      connectedInfo.identity = await this.fetchIdentityUsingSeed(connectedInfo.seed);
    } else {
      await this.saveIdentityUsingSeed(connectedInfo.identity, connectedInfo.seed);
    }

    // Save the seed in local storage.
    localStorage.setItem(loginKey, connectedInfo.seed);

    this.connectedInfo = connectedInfo
    return connectedInfo;
  }

  protected async fetchSkappPermissions(connectedInfo: ConnectedInfo, skappInfo: SkappInfo): Promise<boolean | null> {
    const childSeed = deriveChildSeed(connectedInfo.seed, skappInfo.domain);
    const { publicKey } = genKeyPairFromSeed(childSeed);

    try {
      const { data } = await this.client.db.getJSON(publicKey, providerUrl);
      if (!data.permission) {
        return null;
      }

      return data.permission;
    } catch (error) {
      return null;
    }
  }

  protected async saveSkappPermissions(connectedInfo: ConnectedInfo, skappInfo: SkappInfo, permission: boolean): Promise<void> {
    const childSeed = deriveChildSeed(connectedInfo.seed, skappInfo.domain);
    const { privateKey } = genKeyPairFromSeed(childSeed);
    return this.client.db.setJSON(privateKey, providerUrl, { permission });
  }

  // TODO: should check periodically if window is still open.
  /**
   * Creates window with login UI and waits for a response.
   */
  protected async queryUserForConnection(): Promise<ConnectedInfo> {
    // Set the ui URL.
    const identityUiUrl = "identity.html";

    const promise: Promise<ConnectedInfo> = new Promise((resolve, reject) => {
      // Register a message listener.
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== location.origin)
          return;

        window.removeEventListener("message", handleMessage);

        // Resolve or reject the promise.
        if (!event.data || !event.data.seed) {
          reject(new Error("did not get connection info"));
        }
        const { seed } = event.data;
        if (seed === "") {
          reject(new Error("invalid seed"));
        }
        resolve(event.data);
      };

      window.addEventListener("message", handleMessage);
    });

    // Open the ui.
    const newWindow = popupCenter(identityUiUrl, providerName, uiW, uiH);

    return promise;
  }

  // TODO: should check periodically if window is still open.
  /**
   * Creates window with permissions UI and waits for a response.
   */
  protected async queryUserForSkappPermission(skappInfo: SkappInfo): Promise<boolean> {
    // Set the ui URL.
    const permissionsUiUrl = `permissions.html?name=${skappInfo.name}&domain=${skappInfo.domain}`;

    const promise: Promise<boolean> = new Promise((resolve, reject) => {
      // Register a message listener.
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== location.origin)
          return;

        window.removeEventListener("message", handleMessage);

        // If window closed, don't deny the permission -- fail the operation instead.
        if (!event.data || event.data === "") {
          reject(new Error("permissions were neither granted nor denied"));
        }

        // Resolve or reject the promise.
        if (event.data === "grant") {
          resolve(true);
        } else if (event.data === "deny") {
          resolve(false);
        }
        reject(new Error("permissions were neither granted nor denied"));
      };

      window.addEventListener("message", handleMessage);
    });

    // Open the ui.
    const newWindow = popupCenter(permissionsUiUrl, providerName, uiW, uiH);

    return promise;
  }

  // =================
  // Interface Methods
  // =================

  protected async identity(): Promise<string> {
    if (!this.connectedInfo) {
      throw new Error("provider does not have connection info");
    }

    return this.connectedInfo.identity;
  }

  // ================
  // Internal Methods
  // ================

  protected async fetchIdentityUsingSeed(seed: string): Promise<string> {
    const { publicKey } = genKeyPairFromSeed(seed);
    const { data } =  await this.client.db.getJSON(publicKey, providerUrl, { timeout: 10 });
    if (!data.identity) {
      throw new Error("identity not found on returned data object");
    }
    return data.identity;
  }

  protected async saveIdentityUsingSeed(identity: string, seed: string): Promise<void> {
    const { privateKey } = genKeyPairFromSeed(seed);
    return this.client.db.setJSON(privateKey, providerUrl, { identity });
  }
}

// ===============
// START EXECUTION
// ===============

// Launch the provider.
new IdentityProvider();
