import { useTranslation } from 'react-i18next';
import { useFileBrowserColumns, type ToggleableFileColumn } from '@/lib/file-browser-columns';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

export function FileColumnMenu({ permissions = false, owner = false }: { permissions?: boolean; owner?: boolean }) {
  const { t } = useTranslation();
  const { isColumnVisible, setColumnVisible } = useFileBrowserColumns();
  const columns: ToggleableFileColumn[] = [
    'size',
    'modified',
    ...(permissions ? ['permissions' as const] : []),
    ...(owner ? ['owner' as const] : []),
  ];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t('fileBrowser.toolbar.columns')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={isColumnVisible(column)}
            onCheckedChange={(checked) => setColumnVisible(column, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            {t(`fileBrowser.column.${column}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
