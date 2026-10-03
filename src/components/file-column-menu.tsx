import { useTranslation } from 'react-i18next';
import { useFileBrowserColumns } from '@/lib/file-browser-columns';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

export function FileColumnMenu({ permissions = false, owner = false }: { permissions?: boolean; owner?: boolean }) {
  const { t } = useTranslation();
  const { isColumnVisible, setColumnVisible } = useFileBrowserColumns();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t('fileBrowser.toolbar.columns')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {(['name', 'size', 'modified'] as const).map((column) => (
          <DropdownMenuCheckboxItem key={column} checked disabled>
            {t(`fileBrowser.column.${column}`)}
          </DropdownMenuCheckboxItem>
        ))}
        {(['permissions', 'owner'] as const).filter((column) => column === 'permissions' ? permissions : owner).map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={isColumnVisible(column)}
            onCheckedChange={(checked) => setColumnVisible(column, checked)}
            onSelect={(event) => event.preventDefault()}
          >
            {t(`fileBrowser.column.${column}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
