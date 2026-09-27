import type { Metadata } from 'next';
import './globals.css';
import {SessionGate} from './components/session-gate';
export const metadata:Metadata={title:'Abastecimento | Controle de frota',description:'Registro de abastecimento da frota',icons:{icon:'/icon.png?v=sd-original-only',apple:'/icon.png?v=sd-original-only'}};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR"><body><SessionGate>{children}</SessionGate></body></html> }
