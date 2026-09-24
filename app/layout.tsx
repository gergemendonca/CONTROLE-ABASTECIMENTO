import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Abastecimento | Controle de frota',description:'Registro de abastecimento da frota',icons:{icon:'/icon-192.png',apple:'/apple-touch-icon.png'}};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR"><body>{children}</body></html> }
