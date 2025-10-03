export const metadata = {
    title: "Oljefondet per nordmann",
    description: "Superenkel status og graf"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="nb">
            <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
                {children}
            </body>
        </html>
    );
}
