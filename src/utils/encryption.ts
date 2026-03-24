export interface EncryptedMessage {
  encrypted_message: string;
  encrypted_aes_key: string;
  nonce: string;
  tag: string;
}

export class ClientEncryption {
  private static async importPublicKey(pemKey: string): Promise<CryptoKey> {
    const pemContents = pemKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');

    const binaryDer = this.base64ToArrayBuffer(pemContents);

    return await window.crypto.subtle.importKey(
      'spki',
      binaryDer,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      true,
      ['encrypt']
    );
  }

  private static async importPrivateKey(pemKey: string): Promise<CryptoKey> {
    const pemContents = pemKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');

    const binaryDer = this.base64ToArrayBuffer(pemContents);

    return await window.crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      true,
      ['decrypt']
    );
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  static async generateKeyPair(): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    );

    const publicKeySpki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyPkcs8 = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    const publicBase64 = this.arrayBufferToBase64(publicKeySpki);
    const privateBase64 = this.arrayBufferToBase64(privateKeyPkcs8);

    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

    return { publicKeyPem, privateKeyPem };
  }

  static async encryptMessage(
    message: string,
    recipientPublicKeyPem: string
  ): Promise<EncryptedMessage> {
    const aesKey = await window.crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );

    const nonce = window.crypto.getRandomValues(new Uint8Array(12));

    const messageBytes = new TextEncoder().encode(message);
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
      },
      aesKey,
      messageBytes
    );

    const encryptedMessage = encryptedData.slice(0, -16);
    const tag = encryptedData.slice(-16);

    const exportedAesKey = await window.crypto.subtle.exportKey('raw', aesKey);

    const publicKey = await this.importPublicKey(recipientPublicKeyPem);
    const encryptedAesKey = await window.crypto.subtle.encrypt(
      {
        name: 'RSA-OAEP',
      },
      publicKey,
      exportedAesKey
    );

    return {
      encrypted_message: this.arrayBufferToBase64(encryptedMessage),
      encrypted_aes_key: this.arrayBufferToBase64(encryptedAesKey),
      nonce: this.arrayBufferToBase64(nonce.buffer),
      tag: this.arrayBufferToBase64(tag),
    };
  }

  static async decryptMessage(
    encryptedData: EncryptedMessage,
    privateKeyPem: string
  ): Promise<string> {
    const encryptedMessage = this.base64ToArrayBuffer(encryptedData.encrypted_message);
    const encryptedAesKey = this.base64ToArrayBuffer(encryptedData.encrypted_aes_key);
    const nonce = this.base64ToArrayBuffer(encryptedData.nonce);
    const tag = this.base64ToArrayBuffer(encryptedData.tag);

    const privateKey = await this.importPrivateKey(privateKeyPem);
    const aesKeyBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'RSA-OAEP',
      },
      privateKey,
      encryptedAesKey
    );

    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      aesKeyBuffer,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['decrypt']
    );

    const combinedData = new Uint8Array(encryptedMessage.byteLength + tag.byteLength);
    combinedData.set(new Uint8Array(encryptedMessage), 0);
    combinedData.set(new Uint8Array(tag), encryptedMessage.byteLength);

    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
      },
      aesKey,
      combinedData
    );

    return new TextDecoder().decode(decryptedData);
  }
}
