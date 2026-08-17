/* The onboarding pack we send a new customer once their onboarding starts.
 *
 * One definition, used by three surfaces: the public page the customer fills in,
 * the card that shows the answers on the onboarding, and the summary written to
 * the location. Keeping it in one place is why the three can never drift.
 *
 * Field kinds:
 *   text | textarea | choice | file      (file = one or more uploads)
 * `showIf(answers_for_this_section)` hides a field until it is relevant, so the
 * customer is never asked for a VAT number they said they do not have.
 */

export const SECTIONS = [
  {
    key: 'company',
    title: 'Company details',
    hint: 'The legal entity we contract with and invoice.',
    fields: [
      { key: 'legal_name', label: 'Legal entity name', type: 'text', required: true },
      { key: 'contact_name', label: 'Company contact full name', type: 'text', required: true },
      { key: 'address', label: 'Full address', type: 'textarea', required: true },
    ],
  },
  {
    key: 'trading',
    title: 'Trading details',
    hint: 'What the public sees. Often different from the legal entity.',
    fields: [
      { key: 'trading_name', label: 'Trading name', type: 'text', required: true },
      { key: 'same_address', label: 'Is the trading address the same as above?', type: 'choice', options: ['Yes', 'No'], required: true },
      { key: 'trading_address', label: 'Trading address', type: 'textarea', required: true, showIf: (a) => a.same_address === 'No' },
    ],
  },
  {
    key: 'vat',
    title: 'VAT',
    fields: [
      { key: 'registered', label: 'Are you VAT registered?', type: 'choice', options: ['Yes', 'No'], required: true },
      { key: 'number', label: 'VAT number', type: 'text', required: true, showIf: (a) => a.registered === 'Yes' },
    ],
  },
  {
    key: 'receipt',
    title: 'Receipt details',
    hint: 'What prints on your customer receipts.',
    fields: [
      { key: 'logo', label: 'Logo', type: 'file', hint: 'A PNG or JPG. Square or landscape both work.', required: true },
      { key: 'footer', label: 'Footer message', type: 'textarea', hint: 'Printed at the bottom of every receipt, e.g. thanks and your socials.' },
    ],
  },
  {
    key: 'menu',
    title: 'Menu',
    fields: [
      { key: 'files', label: 'Full food and drink menu', type: 'file', multiple: true, required: true,
        hint: 'Include every modifier and option. A spreadsheet is ideal, but a PDF or photos of the menu are fine.' },
      { key: 'notes', label: 'Anything we should know about the menu', type: 'textarea' },
    ],
  },
  {
    key: 'users',
    title: 'Users',
    fields: [
      { key: 'pos_users', label: 'POS users', type: 'textarea', required: true,
        hint: 'One per line: name, 4 digit PIN, and Manager or Staff. e.g. Jane Smith, 1234, Manager' },
      { key: 'bo_users', label: 'Back office users', type: 'textarea', required: true,
        hint: 'Email addresses to invite, one per line. These people get the reporting and admin login.' },
    ],
  },
  {
    key: 'discounts',
    title: 'Discounts',
    fields: [
      { key: 'list', label: 'Discounts to add to the POS', type: 'textarea',
        hint: 'One per line with the amount, e.g. Staff 50%, Friends and family 20%, Manager comp 100%.' },
    ],
  },
  {
    key: 'tables',
    title: 'Table plan',
    fields: [
      { key: 'files', label: 'Table plan(s)', type: 'file', multiple: true,
        hint: 'A layout we can copy into the system. A drawing, PDF or photo is fine, as long as table names and numbers are readable.' },
      { key: 'notes', label: 'Notes on the layout', type: 'textarea', hint: 'e.g. separate areas, outside tables, a bar with no table service.' },
    ],
  },
  {
    key: 'drinks_printing',
    title: 'Production printing: drinks',
    hint: 'Where drink orders print when staff send them.',
    fields: [
      { key: 'wanted', label: 'Do you want production tickets for drinks?', type: 'choice', options: ['Yes', 'No'], required: true },
      { key: 'areas', label: 'Production areas for drinks', type: 'textarea', required: true, showIf: (a) => a.wanted === 'Yes',
        hint: 'Name each area and the product categories that print there. For example:\n\nHot Drinks Production\n- Tea\n- Coffee\n\nBar\n- Everything else' },
    ],
  },
  {
    key: 'food_printing',
    title: 'Production printing: food',
    fields: [
      { key: 'multiple', label: 'Do you have multiple production centres? (e.g. starters, mains, desserts)', type: 'choice',
        options: ['Yes', 'No', 'Not sure'], required: true },
      { key: 'detail', label: 'How should food printing work?', type: 'textarea', required: true, showIf: (a) => a.multiple !== 'No',
        hint: 'If you know: list which product categories go to each production centre. If you are not sure, just describe how the kitchen works and we will design it with you.' },
    ],
  },
];

/** Fields visible for the answers given (showIf resolved). */
export function visibleFields(section, answers = {}) {
  const a = answers[section.key] || {};
  return section.fields.filter((f) => !f.showIf || f.showIf(a));
}

/** Every required question still unanswered, as [{section, field}]. */
export function missingRequired(answers = {}) {
  const out = [];
  for (const s of SECTIONS) {
    const a = answers[s.key] || {};
    for (const f of visibleFields(s, answers)) {
      if (!f.required) continue;
      const v = a[f.key];
      const empty = f.type === 'file'
        ? !(Array.isArray(v) ? v.length : v)
        : !String(v ?? '').trim();
      if (empty) out.push({ section: s.title, field: f.label });
    }
  }
  return out;
}

/** Plain-text summary, for the activity feed and the location record. */
export function summarize(answers = {}) {
  const lines = [];
  for (const s of SECTIONS) {
    const a = answers[s.key] || {};
    const rows = visibleFields(s, answers)
      .map((f) => {
        const v = a[f.key];
        if (f.type === 'file') {
          const names = (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.name).filter(Boolean);
          return names.length ? `${f.label}: ${names.join(', ')}` : null;
        }
        return String(v ?? '').trim() ? `${f.label}: ${String(v).trim()}` : null;
      })
      .filter(Boolean);
    if (rows.length) lines.push(`${s.title}\n${rows.map((r) => `  ${r}`).join('\n')}`);
  }
  return lines.join('\n\n');
}

/** Every uploaded file across the pack, flattened for attaching to the location. */
export function allFiles(answers = {}) {
  const out = [];
  for (const s of SECTIONS) {
    const a = answers[s.key] || {};
    for (const f of s.fields) {
      if (f.type !== 'file') continue;
      const v = a[f.key];
      for (const file of (Array.isArray(v) ? v : v ? [v] : [])) {
        if (file?.path) out.push({ ...file, section: s.title, label: f.label });
      }
    }
  }
  return out;
}
