import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App'; import { AppProviders } from './app/providers'; import './styles.css'; import './styles/layout.css'; import './styles/task-create.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppProviders><App/></AppProviders></React.StrictMode>);
