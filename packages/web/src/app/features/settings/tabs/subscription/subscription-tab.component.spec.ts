import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BillingStateDto } from '@silencewatch/shared';
import { BillingStore } from '../../../../core/billing.store';
import { loadI18n, provideI18n } from '../../../../core/i18n/i18n.testing';
import { REDIRECT } from '../../../../core/redirect';
import { SettingsFeedback } from '../../settings-feedback';
import { SubscriptionTabComponent } from './subscription-tab.component';

const PLANS: BillingStateDto['plans'] = [
  {
    id: 'free',
    amount: 0,
    currency: 'eur',
    purchasable: false,
    limits: { checks: 10, projects: 2, channelsPerProject: 2, retentionDays: 7 },
  },
  {
    id: 'pro',
    amount: 499,
    currency: 'eur',
    purchasable: true,
    limits: { checks: 100, projects: 5, channelsPerProject: 5, retentionDays: 30 },
  },
  {
    id: 'business',
    amount: 999,
    currency: 'eur',
    purchasable: true,
    limits: { checks: 1000, projects: 20, channelsPerProject: 20, retentionDays: 90 },
  },
];

const state = (overrides: Partial<BillingStateDto> = {}): BillingStateDto => ({
  enabled: true,
  plan: 'free',
  plans: PLANS,
  usage: { checks: 4, projects: 1 },
  subscription: null,
  ...overrides,
});

/**
 * The page where someone chooses a plan. It changes nothing itself: the buttons
 * send the browser to Stripe, and the plan changes when Stripe says it was paid.
 */
describe('SubscriptionTabComponent', () => {
  let redirected: string[];
  let http: HttpTestingController;

  async function create(billing: BillingStateDto, language: 'en' | 'fr' = 'en') {
    redirected = [];
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        SettingsFeedback,
        { provide: REDIRECT, useValue: (url: string) => redirected.push(url) },
      ],
    });
    await loadI18n(language);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(BillingStore).state.set(billing);

    const fixture = TestBed.createComponent(SubscriptionTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return {
      fixture,
      element: fixture.nativeElement as HTMLElement,
      feedback: TestBed.inject(SettingsFeedback),
    };
  }

  const buttons = (element: HTMLElement) =>
    Array.from(element.querySelectorAll('button')).map((button) => button.textContent?.trim());

  afterEach(() => localStorage.clear());

  it('shows the plan, what it uses, and the plans that can be bought', async () => {
    const { element } = await create(state());
    const text = element.textContent ?? '';

    expect(element.querySelector('.plan-name')?.textContent).toContain('Free');
    expect(text).toContain('4 of 10');
    expect(text).toContain('1 of 2');
    expect(element.querySelectorAll('.plans .plan')).toHaveLength(3);
    expect(text).toContain('€4.99');
    expect(text).toContain('€9.99');
    expect(text).toContain('30 days');

    // Nothing to buy on the plan everyone starts on, and nothing to manage
    // before there is a subscription.
    expect(buttons(element)).toEqual(['Choose Pro', 'Choose Business']);
    expect(element.querySelector('.is-current .badge')).not.toBeNull();
  });

  it('sends the browser to the payment page for the plan chosen', async () => {
    const { element } = await create(state());

    (element.querySelectorAll('.plans button')[1] as HTMLButtonElement).click();
    const request = http.expectOne('/api/v1/billing/checkout');
    expect(request.request.body).toEqual({ plan: 'business' });
    request.flush({ url: 'https://checkout.stripe.test/s1' });

    expect(redirected).toEqual(['https://checkout.stripe.test/s1']);
  });

  it('sends a subscriber to the portal rather than to a second payment', async () => {
    const { element } = await create(
      state({
        plan: 'pro',
        subscription: {
          status: 'active',
          plan: 'pro',
          currentPeriodEnd: '2026-11-04T00:00:00.000Z',
          cancelAtPeriodEnd: false,
        },
      }),
    );
    expect(buttons(element)).toEqual(['Manage subscription', 'Switch to Business']);
    expect(element.textContent).toContain('Renews on');

    (element.querySelectorAll('.plans button')[0] as HTMLButtonElement).click();
    http.expectOne('/api/v1/billing/portal').flush({ url: 'https://portal.stripe.test/p1' });
    expect(redirected).toEqual(['https://portal.stripe.test/p1']);
    http.expectNone('/api/v1/billing/checkout');
  });

  it('says when the plan ends, and when a payment failed', async () => {
    const ending = await create(
      state({
        plan: 'pro',
        subscription: {
          status: 'active',
          plan: 'pro',
          currentPeriodEnd: '2026-11-04T12:00:00.000Z',
          cancelAtPeriodEnd: true,
        },
      }),
    );
    expect(ending.element.textContent).toMatch(/Ends on .*2026.*back to the Free plan/);

    TestBed.resetTestingModule();
    const failing = await create(
      state({
        plan: 'pro',
        subscription: { status: 'past_due', plan: 'pro', currentPeriodEnd: null, cancelAtPeriodEnd: false },
      }),
    );
    expect(failing.element.querySelector('[role="alert"]')?.textContent).toContain('payment failed');
  });

  it('reports a refusal and lets the person try again', async () => {
    const { element, feedback } = await create(state());
    const choose = element.querySelectorAll('.plans button')[0] as HTMLButtonElement;

    choose.click();
    http
      .expectOne('/api/v1/billing/checkout')
      .flush({ statusCode: 502, message: 'The payment service is not answering right now' }, { status: 502, statusText: 'Bad Gateway' });

    expect(redirected).toEqual([]);
    expect(feedback.error()).toContain('payment service');

    choose.click();
    http.expectOne('/api/v1/billing/checkout');
  });

  it('is written in French, with the amounts the way French writes them', async () => {
    const { element } = await create(state(), 'fr');
    const text = element.textContent ?? '';

    expect(text).toContain('Votre forfait');
    expect(text).toContain('4 sur 10');
    expect(text).toMatch(/4,99\s€/);
    expect(buttons(element)).toEqual(['Choisir Pro', 'Choisir Business']);
  });

  it('shows no bar where nothing is limited', async () => {
    const { element } = await create(
      state({
        plan: 'enterprise',
        plans: [...PLANS],
        usage: { checks: 40, projects: 3 },
      }),
    );
    expect(element.querySelectorAll('.meter')).toHaveLength(0);
    expect(element.textContent).toContain('40 · no limit');
  });
});
