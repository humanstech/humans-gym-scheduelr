import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { addDays, format } from 'date-fns'
import { fixtures } from './helpers'

// Only the isolated local stack: config.ts rejects every non-local E2E target.
function db(statement: string) {
  return execFileSync('docker', ['exec', '-i', 'gym-local-db-1', 'psql', '-X', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8' }).trim()
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'Trainer wallet mobile' : 'Trainer wallet desktop', () => {
    test.use({ storageState: 'tests/.auth/admin.json', ...(mobile ? { viewport: { width: 390, height: 844 } } : {}) })
    test('assigns a trainer, accrues compensation, records and reverses a payment', async ({ page }) => {
      const { suffix, spaceId } = fixtures()
      const email = `e2e-trainer-${mobile ? 'mobile' : 'desktop'}-${suffix}@example.org`
      try {
        await page.goto('/admin?tab=pt')
        const trainers = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Trainer e pagamenti', exact: true }) })
        await trainers.getByLabel('Email del trainer', { exact: true }).fill(email)
        await trainers.getByLabel('Compenso per seduta (€)', { exact: true }).fill('40')
        await trainers.getByRole('button', { name: 'Aggiungi trainer', exact: true }).click()
        const account = trainers.getByRole('listitem').filter({ has: page.getByText(email, { exact: true }) })
        await expect(account).toBeVisible()

        await page.getByRole('button', { name: 'Aggiungi seduta PT', exact: true }).click()
        const create = page.getByRole('dialog', { name: 'Aggiungi seduta PT', exact: true })
        await create.getByLabel('Data', { exact: true }).fill(format(addDays(new Date(), 2), 'yyyy-MM-dd'))
        await create.getByRole('radio', { name: new RegExp(`${mobile ? '18:00' : '10:00'}.*E2E ${suffix}`) }).check()
        await create.getByLabel('Trainer assegnato', { exact: true }).selectOption({ label: email })
        await expect(create.getByLabel('Compenso seduta (€)', { exact: true })).toHaveValue('40')
        await create.getByRole('button', { name: 'Aggiungi seduta', exact: true }).click()
        await expect(create).toBeHidden()
        await page.getByRole('combobox', { name: 'Filtra sedute per trainer' }).selectOption({ label: email })
        await expect(page.getByText(`Trainer: ${email}`, { exact: true })).toBeVisible()
        await page.getByRole('button', { name: /^Azioni seduta/ }).click()
        await page.getByRole('menuitem', { name: 'Trainer e compenso…' }).click()
        const assign = page.getByRole('dialog', { name: 'Trainer e compenso', exact: true })
        await assign.getByLabel('Compenso seduta (€)', { exact: true }).fill('55')
        await assign.getByLabel('Motivo dell’assegnazione o modifica').fill('Compenso concordato')
        await assign.getByRole('button', { name: 'Salva assegnazione' }).click()
        await expect(assign).toBeHidden()
        await expect(page.getByText(/Compenso: 55,00.*Maturato: 0,00/)).toBeVisible()
        await account.getByLabel(`Compenso di ${email}`, { exact: true }).fill('60')
        await account.getByRole('button', { name: 'Salva compenso' }).click()
        await expect(page.getByText('Compenso aggiornato per le nuove sedute', { exact: true })).toBeVisible()
        await expect(page.getByText(/Compenso: 55,00/)).toBeVisible()

        // Finish only this test's session; no production API or real accounts are used.
        db(`UPDATE public.slots s SET date=private.pt_today()-1 FROM public.pt_session_trainers a, public.pt_trainers t WHERE s.id=a.slot_id AND a.trainer_id=t.id AND t.email='${email}' AND s.space_id='${spaceId}';`)
        await page.reload()
        await account.getByRole('button', { name: 'Movimenti e pagamenti' }).click()
        const wallet = page.getByRole('dialog', { name: 'Conto trainer', exact: true })
        await expect(wallet.locator('dl').getByText(/55,00/)).toHaveCount(2)
        await wallet.getByLabel('Importo (€)', { exact: true }).fill('30')
        await wallet.getByLabel('Nota o riferimento', { exact: true }).fill('Bonifico test ottobre')
        await wallet.getByRole('button', { name: 'Registra pagamento', exact: true }).click()
        await expect(wallet.getByText('Bonifico test ottobre', { exact: true })).toBeVisible()
        await expect(wallet.locator('dl').getByText(/25,00/)).toBeVisible()
        await wallet.getByRole('button', { name: 'Storna pagamento', exact: true }).click()
        const reverse = page.getByRole('dialog', { name: 'Storna pagamento', exact: true })
        await reverse.getByLabel('Motivo dello storno', { exact: true }).fill('Riferimento errato')
        await reverse.getByRole('button', { name: 'Conferma storno', exact: true }).click()
        await expect(reverse).toBeHidden()
        await expect(wallet.getByText('Pagamento stornato', { exact: true })).toBeVisible()
        await expect(wallet.locator('dl').getByText(/55,00/)).toHaveCount(2)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      } finally {
        // Ledger is immutable through app/API. Test-only cleanup uses local postgres
        // and is scoped to this unique trainer plus this run's temporary space.
        db(`BEGIN;
          DELETE FROM public.slots s USING public.pt_session_trainers a, public.pt_trainers t WHERE s.id=a.slot_id AND a.trainer_id=t.id AND t.email='${email}' AND s.space_id='${spaceId}';
          DELETE FROM public.pt_trainer_wallet_entries w USING public.pt_trainers t WHERE w.trainer_id=t.id AND t.email='${email}';
          DELETE FROM public.pt_trainers WHERE email='${email}';
          COMMIT;`)
      }
    })
  })
}
