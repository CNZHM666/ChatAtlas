import type { CanvasCard, CanvasEdge, Conversation, ConversationMessage, MessageAnchor } from "../shared/types";
import { DEFAULT_CANVAS_ID } from "../shared/constants";

const now = Date.now();
const card = (
  id: string,
  title: string,
  description: string,
  x: number,
  y: number,
  tags: string[],
  anchors: number,
): CanvasCard => ({
  id,
  canvasId: DEFAULT_CANVAS_ID,
  kind: "topic",
  title,
  description,
  x,
  y,
  tags,
  conversationIds: [],
  anchorIds: Array.from({ length: anchors }, (_, index) => `${id}-anchor-${index + 1}`),
  createdAt: now,
  updatedAt: now,
});

export const mockCards: CanvasCard[] = [
  card("python", "Python", "Language notes and implementation patterns", 0, 210, ["language"], 18),
  card("numpy", "NumPy", "Numerical computing and array semantics", 318, 210, ["python", "numerics"], 13),
  card("broadcasting", "broadcasting", "Shape alignment without explicit loops", 636, 52, ["numpy"], 5),
  card("roots", "np.roots", "Finding roots of polynomial coefficients", 636, 256, ["numpy", "polynomial"], 7),
  card("complex", "complex", "Complex dtype and numeric stability", 954, 150, ["dtype"], 6),
  { ...card("poles", "poles", "Control-system poles and denominator roots", 954, 354, ["control"], 8), kind: "conversation", conversationIds: ["conversation-poles"] },
  card("source", "source implementation", "Trace the library path and edge cases", 1272, 286, ["open-source"], 4),
  card("stability", "stability", "Interpreting poles on the complex plane", 1272, 464, ["control"], 6),
];

export const mockEdges: CanvasEdge[] = [
  ["python", "numpy"],
  ["numpy", "broadcasting"],
  ["numpy", "roots"],
  ["roots", "complex"],
  ["roots", "poles"],
  ["poles", "source"],
  ["poles", "stability"],
].map(([source, target], index) => ({ id: `edge-${index + 1}`, canvasId: DEFAULT_CANVAS_ID, source, target, type: "manual", createdAt: now }));

export const mockConversations: Conversation[] = [
  { id: "conversation-poles", platform: "chatgpt", title: "Python-control poles source", url: "https://chatgpt.com/c/mock-poles", updatedAt: now, messageCount: 6, summary: "Why poles calls np.roots and promotes coefficients to complex.", tags: ["poles", "numpy"] },
  { id: "conversation-dtypes", platform: "chatgpt", title: "Complex dtype in NumPy", url: "https://chatgpt.com/c/mock-complex", updatedAt: now - 4 * 86400000, messageCount: 4, summary: "Complex arrays, casting, and numeric behavior.", tags: ["complex", "dtype"] },
];

export const mockAnchors: MessageAnchor[] = [
  { id: "anchor-astype", conversationId: "conversation-poles", conversationUrl: mockConversations[0].url, messageIndex: 11, role: "user", preview: "Why is astype(complex) needed here?", contentHash: "mock-astype", createdAt: now },
  { id: "anchor-roots", conversationId: "conversation-poles", conversationUrl: mockConversations[0].url, messageIndex: 7, role: "assistant", preview: "np.roots returns the zeros of a polynomial.", contentHash: "mock-roots", createdAt: now - 120000 },
  { id: "anchor-dtype", conversationId: "conversation-dtypes", conversationUrl: mockConversations[1].url, messageIndex: 4, role: "user", preview: "What does complex dtype mean?", contentHash: "mock-dtype", createdAt: now - 4 * 86400000 },
];

const mockMessage = (
  id: string,
  conversationId: string,
  messageIndex: number,
  role: "user" | "assistant",
  content: string,
): ConversationMessage => ({
  id,
  conversationId,
  messageIndex,
  role,
  content,
  preview: content,
  contentHash: `mock-${id}`,
  createdAt: now + messageIndex,
  updatedAt: now + messageIndex,
});

export const mockConversationMessages: Record<string, ConversationMessage[]> = {
  "conversation-poles": [
    mockMessage("mock-poles-1", "conversation-poles", 0, "user", "How does python-control compute poles internally?"),
    mockMessage("mock-poles-2", "conversation-poles", 1, "assistant", "The library reduces the denominator coefficients to a polynomial root problem and delegates the numerical work to NumPy."),
    mockMessage("mock-poles-3", "conversation-poles", 2, "user", "Why does the implementation convert the coefficients with astype(complex)?"),
    mockMessage("mock-poles-4", "conversation-poles", 3, "assistant", "Using a complex dtype preserves roots outside the real axis and avoids discarding imaginary components during the calculation."),
    mockMessage("mock-poles-5", "conversation-poles", 4, "user", "How should I interpret those roots for system stability?"),
    mockMessage("mock-poles-6", "conversation-poles", 5, "assistant", "For a continuous-time system, poles in the left half-plane indicate decay; poles in the right half-plane indicate instability."),
  ],
  "conversation-dtypes": [
    mockMessage("mock-dtype-1", "conversation-dtypes", 0, "user", "What does a complex dtype mean in NumPy?"),
    mockMessage("mock-dtype-2", "conversation-dtypes", 1, "assistant", "It stores a real and imaginary component for every array element while keeping vectorized NumPy operations."),
    mockMessage("mock-dtype-3", "conversation-dtypes", 2, "user", "When should I cast an array to complex explicitly?"),
    mockMessage("mock-dtype-4", "conversation-dtypes", 3, "assistant", "Cast before an operation that can produce complex values when the input begins as a real-valued array."),
  ],
};
