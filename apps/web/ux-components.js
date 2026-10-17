'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArtisysUxComponents = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const STATUS_TONES = new Set(['neutral', 'success', 'warning', 'danger', 'info', 'muted']);
  const ACTION_TONES = new Set(['default', 'danger']);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function safeClassList(value) {
    return String(value || '')
      .split(/\s+/)
      .filter((token) => /^[a-zA-Z0-9_-]+$/.test(token))
      .join(' ');
  }

  function dataActionAttributes(action = {}) {
    const attrs = [];
    if (action.key) attrs.push(`data-action="${escapeHtml(action.key)}"`);
    if (action.entityId != null) attrs.push(`data-entity-id="${escapeHtml(action.entityId)}"`);
    if (action.disabled) attrs.push('disabled aria-disabled="true"');
    return attrs.join(' ');
  }

  function StatusBadge({ label = '', tone = 'neutral', title = '' } = {}) {
    const normalizedTone = STATUS_TONES.has(String(tone)) ? String(tone) : 'neutral';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<span class="ux-status ux-status--${normalizedTone}" data-ux-component="StatusBadge"${titleAttr}>${escapeHtml(label)}</span>`;
  }

  function EmptyState({ title = 'Nenhum registro encontrado', description = '', action = null, compact = false } = {}) {
    const actionHtml = action?.label
      ? `<button type="button" class="${action.primary ? 'primary-button' : 'secondary-button'} ux-empty-state__action" ${dataActionAttributes(action)}>${escapeHtml(action.label)}</button>`
      : '';
    return `<div class="ux-empty-state${compact ? ' ux-empty-state--compact' : ''}" data-ux-component="EmptyState"><strong>${escapeHtml(title)}</strong>${description ? `<p>${escapeHtml(description)}</p>` : ''}${actionHtml}</div>`;
  }

  function DataTable({ columns = [], rows = [], rowKey = 'id', ariaLabel = 'Dados', empty = null, className = '' } = {}) {
    const normalizedColumns = Array.isArray(columns) ? columns.filter((column) => column && column.key) : [];
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const extraClass = safeClassList(className);
    const rootClass = `ux-data-table${extraClass ? ` ${extraClass}` : ''}`;

    if (!normalizedRows.length) {
      return `<div class="${rootClass}" data-ux-component="DataTable" data-empty="true">${EmptyState(empty || {})}</div>`;
    }

    const head = normalizedColumns.map((column) => {
      const align = ['start', 'center', 'end'].includes(column.align) ? column.align : 'start';
      return `<th scope="col" class="ux-data-table__cell ux-data-table__cell--${align}">${escapeHtml(column.label ?? column.key)}</th>`;
    }).join('');

    const body = normalizedRows.map((row, rowIndex) => {
      const id = typeof rowKey === 'function' ? rowKey(row, rowIndex) : row?.[rowKey];
      const cells = normalizedColumns.map((column) => {
        const align = ['start', 'center', 'end'].includes(column.align) ? column.align : 'start';
        const rendered = typeof column.render === 'function'
          ? String(column.render(row, rowIndex) ?? '')
          : escapeHtml(row?.[column.key]);
        return `<td class="ux-data-table__cell ux-data-table__cell--${align}">${rendered}</td>`;
      }).join('');
      return `<tr data-row-id="${escapeHtml(id ?? rowIndex)}">${cells}</tr>`;
    }).join('');

    return `<div class="${rootClass}" data-ux-component="DataTable"><div class="ux-data-table__scroll"><table aria-label="${escapeHtml(ariaLabel)}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function SearchField({ id = 'ux-search', name = '', label = 'Buscar', placeholder = 'Buscar...', value = '', shortcut = '', autocomplete = 'off' } = {}) {
    return `<label class="ux-search-field" data-ux-component="SearchField" for="${escapeHtml(id)}"><span class="ux-search-field__label">${escapeHtml(label)}</span><span class="ux-search-field__control"><span class="ux-search-field__icon" aria-hidden="true">⌕</span><input type="search" id="${escapeHtml(id)}"${name ? ` name="${escapeHtml(name)}"` : ''} placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" autocomplete="${escapeHtml(autocomplete)}">${shortcut ? `<kbd>${escapeHtml(shortcut)}</kbd>` : ''}</span></label>`;
  }

  function FilterBar({ filters = [], activeChips = [], clearAction = '', clearLabel = 'Limpar filtros' } = {}) {
    const filterHtml = (Array.isArray(filters) ? filters : []).map((filter) => {
      const id = String(filter.id || 'filter');
      const options = (Array.isArray(filter.options) ? filter.options : []).map((option) => {
        const selected = String(option.value ?? '') === String(filter.value ?? '');
        return `<option value="${escapeHtml(option.value ?? '')}"${selected ? ' selected' : ''}>${escapeHtml(option.label ?? option.value ?? '')}</option>`;
      }).join('');
      return `<label class="ux-filter-bar__filter"><span>${escapeHtml(filter.label || id)}</span><select data-filter-id="${escapeHtml(id)}"${filter.disabled ? ' disabled' : ''}>${options}</select></label>`;
    }).join('');

    const chips = (Array.isArray(activeChips) ? activeChips : []).map((chip) => {
      const key = escapeHtml(chip.key || '');
      const label = escapeHtml(chip.label || '');
      const action = String(chip.removeAction || chip.action || '').trim();
      if (!action) return `<span class="ux-filter-chip ux-filter-chip--static" data-filter-key="${key}">${label}</span>`;
      return `<button type="button" class="ux-filter-chip" data-action="${escapeHtml(action)}" data-filter-key="${key}" aria-label="Remover filtro ${label}">${label}<span aria-hidden="true">×</span></button>`;
    }).join('');
    const clear = clearAction && chips
      ? `<button type="button" class="ux-filter-bar__clear" data-action="${escapeHtml(clearAction)}">${escapeHtml(clearLabel)}</button>`
      : '';

    return `<div class="ux-filter-bar" data-ux-component="FilterBar"><div class="ux-filter-bar__controls">${filterHtml}</div>${chips ? `<div class="ux-filter-bar__active">${chips}${clear}</div>` : ''}</div>`;
  }

  function ActionMenu({ label = 'Ações', actions = [], className = '' } = {}) {
    const extraClass = safeClassList(className);
    const items = (Array.isArray(actions) ? actions : []).map((action) => {
      const tone = ACTION_TONES.has(String(action.tone)) ? String(action.tone) : 'default';
      return `<button type="button" role="menuitem" class="ux-action-menu__item ux-action-menu__item--${tone}" ${dataActionAttributes(action)}>${escapeHtml(action.label || action.key || 'Ação')}</button>`;
    }).join('');
    return `<details class="ux-action-menu${extraClass ? ` ${extraClass}` : ''}" data-ux-component="ActionMenu"><summary aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span aria-hidden="true">•••</span></summary><div class="ux-action-menu__popover" role="menu" aria-label="${escapeHtml(label)}">${items || '<span class="ux-action-menu__empty">Sem ações disponíveis</span>'}</div></details>`;
  }

  function DetailPanel({ title = '', eyebrow = '', subtitle = '', badge = null, fields = [], actions = [], empty = null } = {}) {
    if (!title && empty) {
      return `<aside class="ux-detail-panel" data-ux-component="DetailPanel" data-empty="true">${EmptyState({ ...empty, compact: true })}</aside>`;
    }

    const fieldsHtml = (Array.isArray(fields) ? fields : []).map((field) => `<div class="ux-detail-panel__field"><small>${escapeHtml(field.label || '')}</small><strong>${escapeHtml(field.value ?? '—')}</strong>${field.hint ? `<span>${escapeHtml(field.hint)}</span>` : ''}</div>`).join('');
    const actionsHtml = (Array.isArray(actions) ? actions : []).map((action) => {
      const className = action.primary ? 'primary-button' : action.tone === 'danger' ? 'danger-button' : 'secondary-button';
      return `<button type="button" class="${className}" ${dataActionAttributes(action)}>${escapeHtml(action.label || action.key || 'Ação')}</button>`;
    }).join('');

    return `<aside class="ux-detail-panel" data-ux-component="DetailPanel">${eyebrow ? `<small class="ux-detail-panel__eyebrow">${escapeHtml(eyebrow)}</small>` : ''}<div class="ux-detail-panel__head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${badge ? StatusBadge(badge) : ''}</div>${fieldsHtml ? `<div class="ux-detail-panel__fields">${fieldsHtml}</div>` : ''}${actionsHtml ? `<div class="ux-detail-panel__actions">${actionsHtml}</div>` : ''}</aside>`;
  }


  let dialogSequence = 0;

  function openFormDialog({
    title = '',
    description = '',
    body = '',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    tone = 'default',
    initialFocus = 'first',
    validate = null,
    onConfirm = null
  } = {}) {
    if (typeof document === 'undefined') return Promise.reject(new Error('Dialog indisponível fora do renderer.'));
    const previousFocus = document.activeElement;
    const dialogId = `ux-dialog-${++dialogSequence}`;
    const dialog = document.createElement('dialog');
    const confirmClass = tone === 'danger' ? 'ops-danger ux-dialog__confirm' : 'ops-primary ux-dialog__confirm';
    dialog.className = 'ux-dialog';
    dialog.setAttribute('aria-labelledby', `${dialogId}-title`);
    if (description) dialog.setAttribute('aria-describedby', `${dialogId}-description`);
    dialog.innerHTML = `<form method="dialog" class="ux-dialog__form" novalidate>
      <div class="ux-dialog__head">
        <h2 id="${dialogId}-title">${escapeHtml(title)}</h2>
        ${description ? `<p id="${dialogId}-description">${escapeHtml(description)}</p>` : ''}
      </div>
      <div class="ux-dialog__body">${String(body || '')}</div>
      <p class="ux-dialog__error" role="alert" aria-live="assertive" hidden></p>
      <div class="ux-dialog__actions">
        <button type="button" class="ops-secondary ux-dialog__cancel">${escapeHtml(cancelLabel)}</button>
        <button type="submit" class="${confirmClass}">${escapeHtml(confirmLabel)}</button>
      </div>
    </form>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector('form');
    const cancelButton = dialog.querySelector('.ux-dialog__cancel');
    const confirmButton = dialog.querySelector('.ux-dialog__confirm');
    const errorNode = dialog.querySelector('.ux-dialog__error');
    let busy = false;
    let settled = false;

    const setBusy = (next) => {
      busy = Boolean(next);
      confirmButton.disabled = busy;
      cancelButton.disabled = busy;
      confirmButton.setAttribute('aria-busy', busy ? 'true' : 'false');
      form.querySelectorAll('input,select,textarea').forEach((field) => { field.disabled = busy; });
    };
    const showError = (message, fieldName = '') => {
      errorNode.textContent = String(message || 'Não foi possível concluir a operação.');
      errorNode.hidden = false;
      const field = fieldName ? form.elements.namedItem(fieldName) : null;
      field?.focus?.();
    };
    const finish = (result) => {
      if (settled) return result;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      previousFocus?.focus?.({ preventScroll: true });
      return result;
    };

    return new Promise((resolve) => {
      const cancel = () => {
        if (busy) return;
        resolve(finish({ confirmed: false, data: null, value: null }));
      };
      cancelButton.addEventListener('click', cancel);
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); cancel(); });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        errorNode.hidden = true;
        const data = Object.fromEntries(new FormData(form).entries());
        const validation = typeof validate === 'function' ? validate(data, form) : null;
        if (validation) {
          const issue = typeof validation === 'string' ? { message: validation } : validation;
          showError(issue.message, issue.field);
          return;
        }
        setBusy(true);
        try {
          const value = typeof onConfirm === 'function' ? await onConfirm(data, form) : data;
          resolve(finish({ confirmed: true, data, value }));
        } catch (error) {
          setBusy(false);
          showError(error?.message || String(error));
        }
      });

      dialog.showModal();
      queueMicrotask(() => {
        if (initialFocus === 'cancel') cancelButton.focus();
        else if (typeof initialFocus === 'string' && initialFocus.startsWith('#')) dialog.querySelector(initialFocus)?.focus?.();
        else form.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])')?.focus?.();
      });
    });
  }

  return Object.freeze({
    DataTable,
    StatusBadge,
    SearchField,
    FilterBar,
    EmptyState,
    ActionMenu,
    DetailPanel,
    openFormDialog
  });
});
