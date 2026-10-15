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
