export interface WeChatAssistantStatus { available: boolean; version: string | null; method: 'WINDOWS_LOCAL_TEXT' | 'WINDOWS_LOCAL_OCR'; message: string }
export interface WeChatImportMessage { clientId: string; sender: 'USER' | 'OTHER' | 'UNKNOWN'; text: string; sentAt: string | null; possibleDuplicate: boolean }
export interface WeChatImportPreview { previewId: string; contactId: string; conversationTitle: string; capturedAt: string; expiresAt: string; wechatVersion: string | null; messages: WeChatImportMessage[]; warnings: string[] }
export interface WeChatImportResult { importId: string; contactId: string; importedCount: number; skippedCount: number; messageIds: string[] }
