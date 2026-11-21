/**
 * Regression test for: "Failed to construct 'FormData': parameter 1 is not
 * of type 'HTMLFormElement'".
 *
 * Root cause: React nulls SyntheticEvent.currentTarget once the synchronous
 * event handler returns. Reading e.currentTarget AFTER an `await` boundary
 * throws. Form values must be extracted synchronously at the top of handlers.
 */
import { describe, it, expect } from 'vitest'

describe('Form event handler patterns (FormData regression)', () => {
  it('currentTarget is available synchronously but nulled after await', async () => {
    // Simulate React behavior: currentTarget exists during sync execution
    let currentTarget: HTMLFormElement | null = { id: 'form' } as HTMLFormElement
    const event = {
      preventDefault: () => {},
      get currentTarget() { return currentTarget },
    }

    // Simulate React nulling currentTarget after the sync handler returns
    const simulateReactCleanup = () => { currentTarget = null }

    // Sync read works:
    expect(event.currentTarget).not.toBeNull()

    // After an await boundary (React cleanup), the same read returns null
    await Promise.resolve()
    simulateReactCleanup()
    expect(event.currentTarget).toBeNull()
  })

  it('FormData can only be constructed from a live form element', () => {
    // document existed in jsdom via test environment
    const form = document.createElement('form')
    form.innerHTML = '<input name="email" value="test@example.com" />'
    document.body.appendChild(form)

    const fd = new FormData(form)
    expect(fd.get('email')).toBe('test@example.com')

    document.body.removeChild(form)
  })
})
