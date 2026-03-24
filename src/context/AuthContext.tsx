import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../utils/api';

interface AuthContextType {
  user: User | null;
  privateKey: string | null;
  login: (user: User, privateKey?: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');

    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      let storedPrivateKey = localStorage.getItem(`privateKey_${parsedUser.username}`);
      if (!storedPrivateKey) {
        storedPrivateKey = localStorage.getItem('privateKey');
        if (storedPrivateKey) {
          // Migrate it to the new scoped structure so it works going forward
          localStorage.setItem(`privateKey_${parsedUser.username}`, storedPrivateKey);
        }
      }
      if (storedPrivateKey) {
        setPrivateKey(storedPrivateKey);
      }
    }
  }, []);

  const login = (userData: User, userPrivateKey?: string) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));

    const keyToStore = userPrivateKey || userData.private_key;
    if (keyToStore) {
      setPrivateKey(keyToStore);
      localStorage.setItem(`privateKey_${userData.username}`, keyToStore);
    } else {
      let existingKey = localStorage.getItem(`privateKey_${userData.username}`);
      if (!existingKey) {
        existingKey = localStorage.getItem('privateKey');
        if (existingKey) {
          // Migrate it
          localStorage.setItem(`privateKey_${userData.username}`, existingKey);
        }
      }
      if (existingKey) {
        setPrivateKey(existingKey);
      }
    }
  };

  const logout = () => {
    setUser(null);
    setPrivateKey(null);
    localStorage.removeItem('user');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        privateKey,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
