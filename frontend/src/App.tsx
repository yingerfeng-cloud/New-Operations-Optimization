import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { PlatformAccess } from './components/PlatformAccess';
export default function App() { return <><PlatformAccess /><RouterProvider router={router} /></>; }
