import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import BetweenlyRoot from './BetweenlyRoot.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BetweenlyRoot /></StrictMode>);
