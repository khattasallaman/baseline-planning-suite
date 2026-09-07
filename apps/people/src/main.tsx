import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PeopleApp from './App';
import { asUserId } from '@baseline/contracts';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <PeopleApp
      currency="EUR"
      user={{ id: asUserId('user-standalone'), name: 'Standalone User' }}
    />
  </StrictMode>,
);
