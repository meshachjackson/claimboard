// True below 768px wide. The phone layout swaps columns for a tab strip.
import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useIsPhone() {
  const isPhone = ref(false)
  let mq: MediaQueryList | null = null
  const update = () => { isPhone.value = !!mq?.matches }

  onMounted(() => {
    mq = window.matchMedia('(max-width: 767px)')
    update()
    mq.addEventListener('change', update)
  })
  onBeforeUnmount(() => mq?.removeEventListener('change', update))

  return isPhone
}
