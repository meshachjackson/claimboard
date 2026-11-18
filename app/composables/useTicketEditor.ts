// One ticket editor for the whole board: "New card" opens it empty, the drawer's Edit opens it on a card.
import { ref } from 'vue'

const open = ref(false)
const taskId = ref('') // blank: a new ticket
const project = ref('') // a new ticket's starting project (a project lane's "New card"), else blank

export function useTicketEditor() {
  return {
    open,
    taskId,
    project,
    create(projectId = '') {
      taskId.value = ''
      project.value = projectId
      open.value = true
    },
    edit(id: string) {
      taskId.value = id
      open.value = true
    }
  }
}
