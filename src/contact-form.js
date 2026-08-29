class KujoContactForm extends HTMLElement {
  connectedCallback() {
    const endpoint = (this.getAttribute('endpoint') || 'http://127.0.0.1:4310').replace(/\/$/, '');
    const formKey = this.getAttribute('form-key') || 'contact';
    const successMessage = this.getAttribute('success-message') || 'Thanks. Your message has been received.';
    const showSubject = this.getAttribute('subject') !== 'false';
    const id = `kujo-contact-${Math.random().toString(36).slice(2)}`;

    this.innerHTML = `
      <form class="kujo-contact-form" novalidate>
        <label for="${id}-name">Name</label>
        <input id="${id}-name" name="name" autocomplete="name" minlength="2" maxlength="160" required>
        <label for="${id}-email">Email</label>
        <input id="${id}-email" name="email" type="email" autocomplete="email" maxlength="254" required>
        ${showSubject ? `<label for="${id}-subject">Subject</label><input id="${id}-subject" name="subject" maxlength="200">` : ''}
        <label for="${id}-message">Message</label>
        <textarea id="${id}-message" name="message" minlength="10" maxlength="10000" required></textarea>
        <div class="kujo-contact-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <button type="submit">Send message</button>
        <p class="kujo-contact-status" role="status" aria-live="polite"></p>
      </form>`;

    const form = this.querySelector('form');
    const button = this.querySelector('button');
    const status = this.querySelector('[role="status"]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      button.disabled = true;
      status.textContent = 'Sending…';
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const response = await fetch(`${endpoint}/v1/forms/${encodeURIComponent(formKey)}/submissions`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || 'Your message could not be sent.');
        form.reset();
        status.textContent = successMessage;
        this.dispatchEvent(new CustomEvent('kujo-contact-submitted', { bubbles: true, detail: { formKey } }));
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Your message could not be sent.';
      } finally {
        button.disabled = false;
      }
    });
  }
}

if (!customElements.get('kujo-contact-form')) customElements.define('kujo-contact-form', KujoContactForm);
