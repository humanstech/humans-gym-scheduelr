export function LegalLinks() {
  return (
    <nav aria-label="Informazioni legali" className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <a className="underline underline-offset-4 hover:text-foreground" href="/terms">Termini e condizioni</a>
      <a className="underline underline-offset-4 hover:text-foreground" href="/privacy">Privacy policy</a>
      <a className="underline underline-offset-4 hover:text-foreground" href="/cookies">Cookie policy</a>
    </nav>
  )
}
