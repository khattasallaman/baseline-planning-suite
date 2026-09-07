import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { asUserId } from '@baseline/contracts';
import DeliveryApp from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <DeliveryApp
      currency="EUR"
      user={{ id: asUserId('user-standalone'), name: 'Standalone User' }}
    />
  </StrictMode>,
);
