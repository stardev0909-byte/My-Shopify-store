(() => {
  const SOFT_WINTER_JACKET = 'Soft Winter Jacket';

  function money(cents, moneyFormat) {
    const amount = (Number(cents) / 100).toFixed(2);
    if (!moneyFormat) return amount;
    return moneyFormat
      .replace(/\{\{\s*amount\s*\}\}/, amount)
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/, String(Math.round(Number(cents) / 100)));
  }

  function stripHtml(html) {
    const el = document.createElement('div');
    el.innerHTML = html || '';
    return (el.textContent || el.innerText || '').trim();
  }

  function findVariant(product, selections) {
    return product.variants.find((variant) =>
      product.options.every((optionName, index) => {
        const selected = selections[optionName];
        if (!selected) return true;
        return variant[`option${index + 1}`] === selected;
      })
    );
  }

  function hasOptionValue(variant, value) {
    return [variant.option1, variant.option2, variant.option3]
      .filter(Boolean)
      .some((option) => option.toLowerCase() === value.toLowerCase());
  }

  function isColorOption(name) {
    return /colou?r/i.test(name || '');
  }

  function isSizeOption(name) {
    return /size|taille/i.test(name || '');
  }

  function colorSwatch(value) {
    const map = {
      black: '#000000',
      white: '#ffffff',
      blue: '#2f5bff',
      red: '#d32f2f',
      green: '#2e7d32',
      yellow: '#fbc02d',
      brown: '#795548',
      beige: '#d7c4a3',
      grey: '#9e9e9e',
      gray: '#9e9e9e',
      navy: '#1a237e',
      pink: '#e91e63',
      orange: '#ef6c00',
      purple: '#7b1fa2',
    };
    const key = String(value || '').toLowerCase().trim();
    return map[key] || key;
  }

  async function cartAdd(items) {
    const root = window.Shopify?.routes?.root || '/';
    const response = await fetch(`${root}cart/add.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.description || error.message || 'Could not add to cart');
    }

    return response.json();
  }

  async function findSoftWinterJacketVariantId() {
    const root = window.Shopify?.routes?.root || '/';
    const response = await fetch(
      `${root}search/suggest.json?q=${encodeURIComponent(SOFT_WINTER_JACKET)}&resources[type]=product&resources[limit]=5`
    );
    if (!response.ok) return null;

    const data = await response.json();
    const products = data?.resources?.results?.products || [];
    const match = products.find(
      (product) => (product.title || '').toLowerCase() === SOFT_WINTER_JACKET.toLowerCase()
    );
    if (!match) return null;

    if (match.variants?.length) {
      const available = match.variants.find((variant) => variant.available !== false);
      return available?.id || match.variants[0].id;
    }

    const productResponse = await fetch(`${root}products/${match.handle}.js`);
    if (!productResponse.ok) return null;
    const product = await productResponse.json();
    const available = product.variants.find((variant) => variant.available);
    return (available || product.variants[0])?.id || null;
  }

  class TestVisonGrid extends HTMLElement {
    connectedCallback() {
      this.moneyFormat = this.dataset.moneyFormat || '';
      this.products = {};
      this.selections = {};
      this.activeHandle = null;
      this.onKeydown = this.onKeydown.bind(this);

      this.overlay = this.querySelector('[data-test-popup-overlay]');
      this.imageEl = this.querySelector('[data-test-popup-image]');
      this.titleEl = this.querySelector('[data-test-popup-title]');
      this.priceEl = this.querySelector('[data-test-popup-price]');
      this.descriptionEl = this.querySelector('[data-test-popup-description]');
      this.optionsEl = this.querySelector('[data-test-popup-options]');
      this.addButton = this.querySelector('[data-test-add-to-cart]');
      this.statusEl = this.querySelector('[data-test-popup-status]');

      this.querySelectorAll('[data-test-product]').forEach((node) => {
        try {
          const product = JSON.parse(node.textContent);
          this.products[product.handle] = product;
        } catch (error) {
          console.error('Invalid product JSON', error);
        }
      });

      this.addEventListener('click', this.onClick.bind(this));
      document.addEventListener('keydown', this.onKeydown);
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this.onKeydown);
    }

    onKeydown(event) {
      if (event.key === 'Escape') {
        const openSelect = this.querySelector('.test-popup__dropdown.is-open');
        if (openSelect) {
          openSelect.classList.remove('is-open');
          return;
        }
        if (this.overlay?.hidden === false) this.closePopup();
      }
    }

    onClick(event) {
      const hotspot = event.target.closest('[data-test-hotspot]');
      if (hotspot) {
        event.preventDefault();
        this.openPopup(hotspot.dataset.productHandle);
        return;
      }

      if (event.target.closest('[data-test-close]') || event.target === this.overlay) {
        this.closePopup();
        return;
      }

      const dropdownTrigger = event.target.closest('[data-test-dropdown-trigger]');
      if (dropdownTrigger) {
        event.preventDefault();
        const dropdown = dropdownTrigger.closest('[data-test-dropdown]');
        const wasOpen = dropdown.classList.contains('is-open');
        this.querySelectorAll('[data-test-dropdown].is-open').forEach((el) => el.classList.remove('is-open'));
        if (!wasOpen) dropdown.classList.add('is-open');
        return;
      }

      const dropdownOption = event.target.closest('[data-test-dropdown-option]');
      if (dropdownOption) {
        event.preventDefault();
        const dropdown = dropdownOption.closest('[data-test-dropdown]');
        this.selections[dropdownOption.dataset.optionName] = dropdownOption.dataset.testOptionValue;
        dropdown.classList.remove('is-open');
        this.renderOptions();
        this.updatePrice();
        return;
      }

      const optionButton = event.target.closest('[data-test-option-value]');
      if (optionButton) {
        this.selections[optionButton.dataset.optionName] = optionButton.dataset.testOptionValue;
        this.renderOptions();
        this.updatePrice();
        return;
      }

      if (!event.target.closest('[data-test-dropdown]')) {
        this.querySelectorAll('[data-test-dropdown].is-open').forEach((el) => el.classList.remove('is-open'));
      }

      if (event.target.closest('[data-test-add-to-cart]')) {
        event.preventDefault();
        this.addToCart();
      }
    }

    openPopup(handle) {
      const product = this.products[handle];
      if (!product || !this.overlay) return;

      this.activeHandle = handle;
      this.selections = {};
      product.options.forEach((optionName, index) => {
        if (isSizeOption(optionName)) {
          this.selections[optionName] = '';
          return;
        }
        const firstAvailable = product.variants.find((variant) => variant.available);
        const source = firstAvailable || product.variants[0];
        this.selections[optionName] = source[`option${index + 1}`];
      });

      this.titleEl.textContent = product.title;
      this.descriptionEl.textContent = stripHtml(product.description);
      this.imageEl.src = product.featured_image || product.images?.[0] || '';
      this.imageEl.alt = product.title;
      this.statusEl.textContent = '';
      this.renderOptions();
      this.updatePrice();

      this.overlay.hidden = false;
      document.body.classList.add('test-popup-open');
    }

    closePopup() {
      if (!this.overlay) return;
      this.overlay.hidden = true;
      this.activeHandle = null;
      document.body.classList.remove('test-popup-open');
    }

    renderOptionGroup(optionName, optionIndex, values) {
      if (isColorOption(optionName)) {
        const buttons = values
          .map((value) => {
            const selected = this.selections[optionName] === value;
            const swatch = colorSwatch(value);
            return `
              <button
                type="button"
                class="test-popup__color${selected ? ' is-selected' : ''}"
                data-option-name="${optionName}"
                data-test-option-value="${value}"
              >
                <span class="test-popup__color-swatch" style="--swatch:${swatch}"></span>
                <span class="test-popup__color-label">${value}</span>
              </button>
            `;
          })
          .join('');

        return `
          <div class="test-popup__option-group">
            <p class="test-popup__option-label">${optionName}</p>
            <div class="test-popup__color-list">${buttons}</div>
          </div>
        `;
      }

      if (isSizeOption(optionName)) {
        const selected = this.selections[optionName];
        const list = values
          .map((value) => {
            const isActive = selected === value;
            return `
              <button
                type="button"
                class="test-popup__dropdown-option${isActive ? ' is-selected' : ''}"
                data-option-name="${optionName}"
                data-test-dropdown-option
                data-test-option-value="${value}"
              >${value}</button>
            `;
          })
          .join('');

        return `
          <div class="test-popup__option-group">
            <p class="test-popup__option-label">${optionName}</p>
            <div class="test-popup__dropdown" data-test-dropdown data-option-name="${optionName}">
              <button type="button" class="test-popup__dropdown-trigger${selected ? ' has-value' : ''}" data-test-dropdown-trigger aria-haspopup="listbox">
                <span class="test-popup__dropdown-value${selected ? ' has-value' : ''}">
                  ${selected || 'Choose your size'}
                </span>
                <span class="test-popup__dropdown-divider" aria-hidden="true"></span>
                <span class="test-popup__dropdown-chevron" aria-hidden="true"></span>
              </button>
              <div class="test-popup__dropdown-menu" role="listbox">${list}</div>
            </div>
          </div>
        `;
      }

      const buttons = values
        .map((value) => {
          const selected = this.selections[optionName] === value;
          return `<button type="button" class="test-popup__option${selected ? ' is-selected' : ''}" data-option-name="${optionName}" data-test-option-value="${value}">${value}</button>`;
        })
        .join('');

      return `
        <div class="test-popup__option-group">
          <p class="test-popup__option-label">${optionName}</p>
          <div class="test-popup__option-list">${buttons}</div>
        </div>
      `;
    }

    renderOptions() {
      const product = this.products[this.activeHandle];
      if (!product || !this.optionsEl) return;

      if (!product.options.length || (product.options.length === 1 && product.options[0] === 'Title')) {
        this.optionsEl.innerHTML = '';
        return;
      }

      const ordered = [...product.options.keys()].sort((a, b) => {
        const aName = product.options[a];
        const bName = product.options[b];
        if (isColorOption(aName) && !isColorOption(bName)) return -1;
        if (!isColorOption(aName) && isColorOption(bName)) return 1;
        if (isSizeOption(aName) && !isSizeOption(bName)) return 1;
        if (!isSizeOption(aName) && isSizeOption(bName)) return -1;
        return a - b;
      });

      this.optionsEl.innerHTML = ordered
        .map((optionIndex) => {
          const optionName = product.options[optionIndex];
          const values = [
            ...new Set(product.variants.map((variant) => variant[`option${optionIndex + 1}`]).filter(Boolean)),
          ];
          return this.renderOptionGroup(optionName, optionIndex, values);
        })
        .join('');
    }

    updatePrice() {
      const product = this.products[this.activeHandle];
      if (!product) return;

      const sizeMissing = product.options.some(
        (optionName) => isSizeOption(optionName) && !this.selections[optionName]
      );
      const variant = findVariant(product, this.selections) || product.variants[0];
      this.priceEl.textContent = money(variant.price, this.moneyFormat);

      const available = !sizeMissing && variant?.available;
      this.addButton.disabled = !available;
      const label = this.addButton.querySelector('[data-test-add-label]') || this.addButton.querySelector('span');
      if (label) label.textContent = available ? 'ADD TO CART' : sizeMissing ? 'ADD TO CART' : 'SOLD OUT';
    }

    async addToCart() {
      const product = this.products[this.activeHandle];
      if (!product) return;

      const sizeMissing = product.options.some(
        (optionName) => isSizeOption(optionName) && !this.selections[optionName]
      );
      if (sizeMissing) {
        this.statusEl.textContent = 'Please choose your size.';
        return;
      }

      const variant = findVariant(product, this.selections);
      if (!variant?.available) {
        this.statusEl.textContent = 'Please select an available variant.';
        return;
      }

      this.addButton.disabled = true;
      this.statusEl.textContent = 'Adding…';

      try {
        const items = [{ id: variant.id, quantity: 1 }];
        const isBlack = hasOptionValue(variant, 'Black');
        const isMedium = hasOptionValue(variant, 'Medium');

        if (isBlack && isMedium) {
          const jacketId = await findSoftWinterJacketVariantId();
          if (jacketId) items.push({ id: jacketId, quantity: 1 });
        }

        await cartAdd(items);
        this.statusEl.textContent = 'Added to cart.';
        document.dispatchEvent(new CustomEvent('cart:refresh'));
        window.dispatchEvent(new CustomEvent('cart:updated'));
      } catch (error) {
        this.statusEl.textContent = error.message || 'Could not add to cart.';
      } finally {
        this.updatePrice();
      }
    }
  }

  if (!customElements.get('test-vison-grid')) {
    customElements.define('test-vison-grid', TestVisonGrid);
  }

  function initTestHeader(header) {
    const toggle = header.querySelector('[data-test-header-toggle]');
    const panel = header.querySelector('[data-test-header-panel]');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
      const isOpen = header.classList.toggle('is-open');
      panel.hidden = !isOpen;
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });
  }

  document.querySelectorAll('[data-test-header]').forEach(initTestHeader);
})();
