import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/components/admin/ptFormat'

export function UserAvatar({ name, email, avatarUrl, size = 'default' }: {
  name: string | null
  email?: string
  avatarUrl: string | null
  size?: 'sm' | 'default' | 'lg'
}) {
  return (
    <Avatar size={size}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback>{initials(name, email)}</AvatarFallback>
    </Avatar>
  )
}
