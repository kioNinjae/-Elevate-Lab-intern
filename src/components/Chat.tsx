import { useState, useEffect, useRef } from 'react';
import { Send, Lock, LogOut, Eye, EyeOff, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../utils/supabase';
import { api, Message, UserListItem } from '../utils/api';
import { ClientEncryption, EncryptedMessage } from '../utils/encryption';

interface DecryptedMessage extends Message {
  decryptedContent?: string;
  decryptionFailed?: boolean;
  decryptionError?: string;
}

export const Chat = () => {
  const { user, privateKey, logout } = useAuth();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [showEncrypted, setShowEncrypted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUsers();

    if (!user) return;

    const channel = supabase
      .channel('messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `recipient_id=eq.${user.user_id}`,
        },
        (payload) => {
          handleNewMessage(payload.new as Message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${user.user_id}`,
        },
        () => {
          // You might not want echo back on sent messages if you do pessimistic UI updates.
          // In the current logic, local UI pessimistic append handles it, so we don't handle our own sent messages.
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);
  useEffect(() => {
    if (selectedUser) {
      loadMessages();
    }
  }, [selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadUsers = async () => {
    try {
      const userList = await api.getUsers();
      setUsers(userList.filter((u) => u.id !== user?.user_id));
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadMessages = async () => {
    if (!selectedUser || !user) return;

    try {
      const messageList = await api.getMessages(user.user_id, selectedUser.id);
      const decryptedMessages = await Promise.all(
        messageList.map((msg) => decryptMessage(msg))
      );
      setMessages(decryptedMessages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const decryptMessage = async (message: Message): Promise<DecryptedMessage> => {
    if (!privateKey || message.sender_id === user?.user_id) {
      if (message.sender_id === user?.user_id) {
        return { ...message, decryptedContent: '[Sent message - no decryption needed]' };
      }
      return { ...message, decryptionFailed: true, decryptionError: 'No private key available' };
    }

    try {
      const encrypted: EncryptedMessage = {
        encrypted_message: message.encrypted_message,
        encrypted_aes_key: message.encrypted_aes_key,
        nonce: message.nonce,
        tag: message.tag,
      };

      const decrypted = await ClientEncryption.decryptMessage(encrypted, privateKey);
      return { ...message, decryptedContent: decrypted };
    } catch (error) {
      console.error('Decryption failed for message', message.id, error);
      return { ...message, decryptionFailed: true, decryptionError: String(error) };
    }
  };

  const handleNewMessage = async (message: Message) => {
    if (
      selectedUser &&
      (message.sender_id === selectedUser.id || message.recipient_id === selectedUser.id)
    ) {
      const decrypted = await decryptMessage(message);
      setMessages((prev) => [...prev, decrypted]);
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !selectedUser || !user) return;

    try {
      const encrypted = await ClientEncryption.encryptMessage(
        messageText,
        selectedUser.public_key
      );

      const messageToInsert = {
        sender_id: user.user_id,
        recipient_id: selectedUser.id,
        ...encrypted,
      };

      const data = await api.sendMessage(messageToInsert);

      setMessages((prev) => [
        ...prev,
        {
          ...data,
          decryptedContent: messageText,
        },
      ]);

      setMessageText('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-screen bg-gray-900 flex">
      <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-white">{user?.username}</h2>
                <p className="text-xs text-gray-400">Encrypted Chat</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (privateKey) {
                    navigator.clipboard.writeText(privateKey);
                    alert('Private key copied to clipboard! Keep it safe.');
                  }
                }}
                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                title="Copy Private Key"
              >
                <Lock className="w-5 h-5 text-gray-400" />
              </button>
              <button
                onClick={logout}
                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 font-medium">
              <Users className="w-4 h-4" />
              CONTACTS
            </div>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u)}
                className={`w-full p-3 rounded-lg mb-1 text-left transition-colors ${selectedUser?.id === u.id
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-700 text-gray-300'
                  }`}
              >
                <div className="font-medium">{u.username}</div>
                <div className="text-xs opacity-70">
                  {u.id === user?.user_id ? 'You' : 'Click to chat'}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {!privateKey && (
          <div className="bg-red-900 border-b border-red-700 p-2 text-center text-red-200 text-sm font-medium">
            ⚠️ Decryption key missing! Log out and paste your private key during login to read your secure messages.
          </div>
        )}
        {selectedUser ? (
          <>
            <div className="bg-gray-800 border-b border-gray-700 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-white text-lg">{selectedUser.username}</h2>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Lock className="w-4 h-4" />
                    End-to-end encrypted
                  </div>
                </div>
                <button
                  onClick={() => setShowEncrypted(!showEncrypted)}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
                >
                  {showEncrypted ? (
                    <>
                      <EyeOff className="w-4 h-4" />
                      Hide Encrypted
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      Show Encrypted
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                const isSent = msg.sender_id === user?.user_id;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-md rounded-2xl px-4 py-3 ${isSent
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-100 border border-gray-700'
                        }`}
                    >
                      {showEncrypted ? (
                        <div className="font-mono text-xs break-all opacity-70">
                          <div className="mb-1">
                            <strong>Encrypted:</strong>
                          </div>
                          <div className="mb-2">{msg.encrypted_message.substring(0, 100)}...</div>
                          <div className="mb-1">
                            <strong>AES Key:</strong>
                          </div>
                          <div>{msg.encrypted_aes_key.substring(0, 100)}...</div>
                        </div>
                      ) : (
                        <div>
                          {msg.decryptionFailed ? (
                            <div className="text-red-300 italic flex flex-col gap-1">
                              <span>[Decryption failed]</span>
                              <span className="text-xs opacity-75 break-words">{msg.decryptionError}</span>
                            </div>
                          ) : (
                            msg.decryptedContent
                          )}
                        </div>
                      )}
                      <div className={`text-xs mt-1 ${isSent ? 'text-blue-200' : 'text-gray-500'}`}>
                        {formatTime(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-gray-700 p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={sendMessage}
                  disabled={!messageText.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white p-3 rounded-lg transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Messages are encrypted with RSA-2048 + AES-256-GCM
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-xl">Select a user to start chatting</p>
              <p className="text-sm mt-2">All messages are end-to-end encrypted</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
