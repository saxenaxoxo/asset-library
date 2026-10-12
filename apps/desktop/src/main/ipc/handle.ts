import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { ipcContract, type IpcRequest, type IpcResponse } from '@shared/schemas'
import type { IpcChannelName } from '@shared/channels'

export type SenderCheck = (event: IpcMainInvokeEvent | IpcMainEvent) => boolean

/**
 * Registers an IPC handler that rejects untrusted senders and validates the request and
 * response against the shared contract. Handlers never see unvalidated input.
 */
export function handle<C extends IpcChannelName>(
  channel: C,
  isTrustedSender: SenderCheck,
  handler: (request: IpcRequest<C>, event: IpcMainInvokeEvent) => Promise<IpcResponse<C>>
): void {
  const { request: requestSchema, response: responseSchema } = ipcContract[channel]
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!isTrustedSender(event)) {
      throw new Error(`Rejected IPC call to "${channel}" from an untrusted sender`)
    }
    const request = requestSchema.parse(raw) as IpcRequest<C>
    const response = await handler(request, event)
    return responseSchema.parse(response)
  })
}

/**
 * Registers a fire-and-forget handler (ipcRenderer.send). Same sender check and request
 * validation as `handle`; invalid messages are dropped and logged.
 */
export function listen<C extends IpcChannelName>(
  channel: C,
  isTrustedSender: SenderCheck,
  handler: (request: IpcRequest<C>, event: IpcMainEvent) => void
): void {
  const { request: requestSchema } = ipcContract[channel]
  ipcMain.on(channel, (event, raw: unknown) => {
    if (!isTrustedSender(event)) {
      console.warn(`Dropped IPC message to "${channel}" from an untrusted sender`)
      return
    }
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn(`Dropped invalid IPC message to "${channel}"`)
      return
    }
    handler(parsed.data as IpcRequest<C>, event)
  })
}
