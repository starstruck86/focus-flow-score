import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { StrategyMessage } from '@/types/strategy';

interface Props {
  message: StrategyMessage;
}

export function StrategyMessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'tool';
  const text = (message.content_json as { text?: string })?.text || JSON.stringify(message.content_json);

  if (message.message_type === 'workflow_update') {
    return (
      <div className="flex justify-center">
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {text}
        </Badge>
      </div>
    );
  }

  if (message.message_type === 'workflow_result' || message.message_type === 'output_card') {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <Badge variant="secondary" className="text-[10px] mb-2">
          {message.message_type === 'workflow_result' ? 'Result' : 'Output'}
        </Badge>
        <p className="text-sm whitespace-pre-wrap">{text}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isSystem
              ? 'bg-muted/50 text-muted-foreground italic'
              : 'bg-muted text-foreground',
        )}
      >
        {text}
      </div>
    </div>
  );
}
