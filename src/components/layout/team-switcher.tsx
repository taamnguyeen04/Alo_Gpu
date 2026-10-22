import { ChevronsUpDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCurrentProfile,
  useProfiles,
  useActivateProfile,
} from '@/hooks/use-modal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const { data: profiles } = useProfiles()
  const { data: currentProfile } = useCurrentProfile()
  const activateProfile = useActivateProfile()

  const handleProfileSelect = async (profileName: string) => {
    try {
      await activateProfile.mutateAsync(profileName)
    } catch (error) {
      toast.error(`Failed to activate profile: ${error}`)
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              <div className='flex aspect-square size-8 items-center justify-center overflow-hidden rounded-full'>
                <img
                  src='/avatars/a.png'
                  alt='Logo'
                  className='h-full w-full object-cover'
                />
              </div>
              <div className='grid flex-1 text-start text-sm leading-tight'>
                <span className='truncate font-semibold'>
                  {currentProfile || 'Modal'}
                </span>
                <span className='truncate text-xs'>Desktop Manager</span>
              </div>
              <ChevronsUpDown className='ms-auto' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
            align='start'
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className='text-xs text-muted-foreground'>
              Modal Profiles
            </DropdownMenuLabel>
            {profiles?.map((profile, index) => (
              <DropdownMenuItem
                key={profile.name}
                onClick={() => handleProfileSelect(profile.name)}
                className='gap-2 p-2'
              >
                <div className='flex size-6 items-center justify-center overflow-hidden rounded-full border'>
                  <img
                    src='/avatars/a.png'
                    alt='Logo'
                    className='h-full w-full object-cover'
                  />
                </div>
                <div className='flex flex-col'>
                  <span>{profile.name}</span>
                  <span className='text-xs text-muted-foreground'>
                    {profile.workspace}
                  </span>
                </div>
                {profile.name === currentProfile && (
                  <span className='ml-auto text-xs text-primary'>Active</span>
                )}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className='gap-2 p-2'>
              <div className='flex size-6 items-center justify-center rounded-md border bg-background'>
                <Plus className='size-4' />
              </div>
              <div className='font-medium text-muted-foreground'>
                Add Profile
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
