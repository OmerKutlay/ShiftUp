/**
 * shadcn (Radix) Dialog içinde hâlâ MUI olan ortak alanlar (DateField takvimi, EmployeeSelect
 * listesi) açılır parçalarını body'ye portal eder. Radix bunlara yapılan tıklama/odaklanmayı
 * "dışarı" sayıp pencereyi kapatmasın diye DialogContent'e verilen olay korumaları.
 */
const MUI_POPUP = '.MuiPopover-root, .MuiPopper-root, .MuiAutocomplete-popper, .MuiModal-root'

function insideMuiPopup(e: Event): boolean {
  const target = e.target
  return target instanceof Element && target.closest(MUI_POPUP) !== null
}

const guard = (e: Event) => { if (insideMuiPopup(e)) e.preventDefault() }

export const keepMuiPopupsInside = {
  onPointerDownOutside: guard,
  onFocusOutside: guard,
  onInteractOutside: guard,
}
