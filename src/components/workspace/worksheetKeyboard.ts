import type React from 'react';

function focusedCell(target: EventTarget): HTMLTableCellElement | null {
  return target instanceof HTMLElement ? target.closest('tbody td') : null;
}

export function focusWorksheetCell(cell: HTMLTableCellElement | null | undefined) {
  if (!cell) return;
  cell.tabIndex = -1;
  cell.focus({ preventScroll: true });
  cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function focusWorksheet(event: React.FocusEvent<HTMLDivElement>, selectRow?: (id: string) => void) {
  if (event.target === event.currentTarget) {
    const cell = event.currentTarget.querySelector<HTMLTableCellElement>('tr.selected[data-worksheet-row] td, tr.selected[data-worksheet-row] th');
    focusWorksheetCell(cell ?? event.currentTarget.querySelector('tr[data-worksheet-row] td'));
  } else {
    const id = focusedCell(event.target)?.parentElement?.dataset.worksheetRow;
    if (id) selectRow?.(id);
  }
}

export function clickWorksheet(event: React.MouseEvent<HTMLDivElement>) {
  if (!(event.target instanceof HTMLElement) || event.target.closest('input, select, button, a')) return;
  const cell = focusedCell(event.target);
  if (cell?.parentElement?.dataset.worksheetRow) focusWorksheetCell(cell);
}

export function navigateWorksheet(
  event: React.KeyboardEvent<HTMLDivElement>,
  insertRow?: () => void,
  cancelEdit?: () => boolean,
) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || event.altKey || event.nativeEvent.isComposing) return;
  const cell = focusedCell(target);
  const editing = target.matches('input, select, textarea');
  const handle = () => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (editing && event.key === 'Escape' && cell) {
    handle();
    if (cancelEdit?.()) {
      requestAnimationFrame(() => focusWorksheetCell(cell));
    } else {
      if (target instanceof HTMLInputElement && target.type !== 'checkbox') target.value = target.defaultValue;
      focusWorksheetCell(cell);
    }
    return;
  }

  if (editing && !['Tab', 'Enter'].includes(event.key)) return;
  if (editing && event.key === 'Enter' && target.matches('select, input[type="checkbox"]')) return;
  if (!editing && event.key === 'Insert' && insertRow) {
    handle();
    insertRow();
    return;
  }

  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLTableRowElement>('tbody tr[data-worksheet-row]'));
  if (!rows.length) return;
  const rowIndex = cell ? rows.indexOf(cell.parentElement as HTMLTableRowElement) : -1;
  if (rowIndex < 0) return;
  const colIndex = cell?.cellIndex ?? 0;
  const end = rows.length - 1;
  let row = rowIndex;
  let col = colIndex;
  if (!editing && (event.key === 'F2' || event.key === 'Enter') && cell && target === cell) {
    const control = cell.querySelector<HTMLElement>(event.key === 'F2'
      ? 'input:enabled, select:enabled'
      : 'input:enabled, select:enabled, button:enabled:not(.tree-toggle)');
    if (control) {
      handle();
      control.focus();
      if (control instanceof HTMLInputElement && control.type === 'text') control.select();
      return;
    }
    handle();
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return;
  }

  switch (event.key) {
    case 'ArrowUp': row--; break;
    case 'ArrowDown':
    case 'Enter': row++; break;
    case 'ArrowLeft': col--; break;
    case 'ArrowRight': col++; break;
    case 'Home': col = 0; if (event.ctrlKey || event.metaKey) row = 0; break;
    case 'End': if (event.ctrlKey || event.metaKey) row = end; col = rows[row].cells.length - 1; break;
    case 'PageUp':
    case 'PageDown': {
      const step = Math.max(1, Math.floor(event.currentTarget.clientHeight / Math.max(1, rows[row].offsetHeight)) - 1);
      row += event.key === 'PageUp' ? -step : step;
      break;
    }
    case 'Tab':
      col += event.shiftKey ? -1 : 1;
      if (col < 0 && row > 0) col = rows[--row].cells.length - 1;
      if (col >= rows[row].cells.length && row < end) { row++; col = 0; }
      if (col < 0 || col >= rows[row].cells.length) return;
      break;
    default: return;
  }

  handle();
  row = Math.max(0, Math.min(end, row));
  col = Math.max(0, Math.min(rows[row].cells.length - 1, col));
  focusWorksheetCell(rows[row].cells[col]);
}
