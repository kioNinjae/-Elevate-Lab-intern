import { useAuth } from './context/AuthContext';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';

function App() {
  const { isAuthenticated } = useAuth();

  return isAuthenticated ? <Chat /> : <Auth />;
}

export default App;
