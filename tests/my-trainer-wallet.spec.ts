import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fixtures } from './helpers'

function db(statement: string) {
  return execFileSync('docker', ['exec', '-i', 'gym-local-db-1', 'psql', '-X', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8' }).trim()
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'My trainer wallet mobile' : 'My trainer wallet desktop', () => {
    test.use({ ...(mobile ? { viewport: { width: 390, height: 844 } } : {}) })
    test('trainer sees their totals at login and only their own read-only history', async ({ page }) => {
      const { suffix } = fixtures()
      const own = randomUUID()
      const other = randomUUID()
      const payment = randomUUID()
      try {
        db(`INSERT INTO public.pt_trainers(id,email) VALUES ('${own}','e2e-user-${suffix}@humans.tech'), ('${other}','e2e-other-${suffix}@example.org');`)
        await page.goto('/')
        const summary = page.getByRole('region', { name: 'Il tuo wallet PT' })
        await expect(summary.locator('dd')).toHaveText([/0,00/, /0,00/, /0,00/])
        await expect(page.getByRole('heading', { name: 'Le tue sedute' })).toBeVisible()
        await summary.getByRole('link', { name: 'Vedi movimenti' }).click()
        await expect(page).toHaveURL(/\/trainer-wallet$/)
        await expect(page.getByText('Nessun movimento registrato.')).toBeVisible()

        // Local, isolated fixture: include a correction, a payment and its reversal.
        db(`INSERT INTO public.pt_trainer_wallet_entries(trainer_id,amount_cents,kind,occurred_on,description) VALUES
            ('${own}',4000,'earning',current_date-2,'Seduta test personale'),
            ('${own}',1000,'adjustment',current_date-1,'Rettifica compenso concordato'),
            ('${other}',9900,'earning',current_date-1,'Movimento privato altro trainer');
          INSERT INTO public.pt_trainer_wallet_entries(id,trainer_id,amount_cents,kind,occurred_on,description,payment_method,request_id) VALUES
            ('${payment}','${own}',-1000,'payment',current_date-1,'Pagamento da stornare','cash',gen_random_uuid()),
            (gen_random_uuid(),'${own}',-2000,'payment',current_date-1,'Bonifico ricevuto','bank_transfer',gen_random_uuid());
          INSERT INTO public.pt_trainer_wallet_entries(trainer_id,amount_cents,kind,occurred_on,description,reverses_entry_id) VALUES
            ('${own}',1000,'payment_reversal',current_date,'Storno pagamento errato','${payment}');`)
        await page.goto('/')
        await expect(summary.locator('dd')).toHaveText([/50,00/, /30,00/, /20,00/])
        await summary.getByRole('link', { name: 'Vedi movimenti' }).click()
        await expect(page.getByRole('heading', { name: 'Compensi PT', exact: true })).toBeVisible()
        await expect(summary.getByRole('listitem')).toHaveCount(5)
        await expect(summary.getByText('Bonifico ricevuto', { exact: true })).toBeVisible()
        await expect(summary.getByText('Pagamento stornato', { exact: true })).toBeVisible()
        await expect(page.getByText('Movimento privato altro trainer')).toHaveCount(0)
        await expect(page.getByRole('button', { name: /Registra pagamento|Storna pagamento/ })).toHaveCount(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

        db(`INSERT INTO public.pt_trainer_wallet_entries(trainer_id,amount_cents,kind,occurred_on,description,payment_method,request_id)
          VALUES ('${own}',-4000,'payment',current_date,'Anticipo prossime sedute','cash',gen_random_uuid());`)
        await page.reload()
        await expect(summary.getByText('Anticipo ricevuto', { exact: true })).toBeVisible()
        await expect(summary.locator('dd')).toHaveText([/50,00/, /10,00/, /60,00/])

        await page.route('**/rest/v1/rpc/pt_my_trainer_wallet', route => route.fulfill({ status: 500, json: { message: 'Test unavailable' } }))
        await page.reload()
        await expect(summary.getByRole('alert')).toContainText('Impossibile caricare il wallet.')
        await expect(summary.locator('dd')).toHaveCount(0)
        await page.unroute('**/rest/v1/rpc/pt_my_trainer_wallet')
        await summary.getByRole('button', { name: 'Riprova' }).click()
        await expect(summary.locator('dd')).toHaveText([/50,00/, /10,00/, /60,00/])

        // Trainers with an admin role also see their personal summary at entry.
        db(`INSERT INTO public.admins(email) VALUES ('e2e-user-${suffix}@humans.tech');`)
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'Prenota una sessione' })).toBeVisible()
        await expect(summary.locator('dd')).toHaveText([/50,00/, /10,00/, /60,00/])
      } finally {
        db(`DELETE FROM public.admins WHERE email='e2e-user-${suffix}@humans.tech';
          DELETE FROM public.pt_trainer_wallet_entries WHERE trainer_id IN ('${own}','${other}');
          DELETE FROM public.pt_trainers WHERE id IN ('${own}','${other}');`)
      }
    })
  })
}

test('ordinary member cannot open the trainer wallet', async ({ page }) => {
  await page.goto('/trainer-wallet')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('region', { name: 'Il tuo wallet PT' })).toHaveCount(0)
})
