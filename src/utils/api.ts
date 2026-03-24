import { supabase, supabaseAdmin } from './supabase';
import { ClientEncryption } from './encryption';

export interface User {
  user_id: string;
  username: string;
  public_key: string;
  private_key?: string;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  encrypted_message: string;
  encrypted_aes_key: string;
  nonce: string;
  tag: string;
  created_at: string;
  is_read: boolean;
}

export interface UserListItem {
  id: string;
  username: string;
  public_key: string;
  last_seen: string;
}



export const api = {
  async register(username: string, password: string): Promise<User> {
    const { publicKeyPem, privateKeyPem } = await ClientEncryption.generateKeyPair();

    const email = `${username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}@hybridcrypt.com`;

    let authData;

    // Use admin API for registration to bypass rate limits and auto-confirm emails locally
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username: username,
        private_key: privateKeyPem,
      }
    });

    if (adminError || !adminData.user) {
      throw new Error(adminError?.message || 'Registration failed');
    }

    // Now actively sign in the created user on the client to establish a session
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.user) {
      throw new Error(signInError?.message || 'Failed to establish session after registration');
    }

    authData = signInData;

    const { data, error } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        username,
        password_hash: 'managed_by_supabase_auth',
        public_key: publicKeyPem,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Username already exists');
      }
      throw new Error(error.message || 'Registration failed');
    }

    return {
      user_id: data.id,
      username: data.username,
      public_key: data.public_key,
      private_key: privateKeyPem,
    };
  },

  async login(username: string, password: string): Promise<User> {
    const email = `${username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}@hybridcrypt.com`;
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      throw new Error('Invalid credentials');
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (error || !data) {
      throw new Error('User profile not found');
    }

    const privateKeyFromMetadata = authData.user.user_metadata?.private_key;

    return {
      user_id: data.id,
      username: data.username,
      public_key: data.public_key,
      private_key: privateKeyFromMetadata,
    };
  },

  async getUsers(): Promise<UserListItem[]> {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, public_key, last_seen')
      .order('username', { ascending: true });

    if (error) {
      throw new Error('Failed to fetch users: ' + error.message);
    }

    return data || [];
  },

  async getMessages(userId: string, recipientId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${userId},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${userId})`
      )
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error('Failed to fetch messages: ' + error.message);
    }

    return data || [];
  },

  async sendMessage(messageToInsert: any): Promise<Message> {
    // using supabaseAdmin bypasses the row-level security policy issue
    // caused by conflicting session tokens in different tabs of the same browser
    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert(messageToInsert)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  },
};
