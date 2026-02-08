// Clickable name component - makes name a link when Salesforce link exists
import { cn } from '@/lib/utils';

interface ClickableNameProps {
  name: string;
  salesforceLink?: string;
  className?: string;
}

export function ClickableName({ name, salesforceLink, className }: ClickableNameProps) {
  if (!salesforceLink) {
    return <span className={className}>{name}</span>;
  }
  
  const normalizedLink = salesforceLink.startsWith('http') 
    ? salesforceLink 
    : `https://${salesforceLink}`;
  
  return (
    <a
      href={normalizedLink}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "hover:underline underline-offset-2 decoration-primary/50 cursor-pointer",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </a>
  );
}

// Account name with Salesforce link
interface AccountNameProps {
  name: string;
  salesforceLink?: string;
  className?: string;
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
}

export function AccountName({ 
  name, 
  salesforceLink, 
  className,
  fontWeight = 'medium' 
}: AccountNameProps) {
  const fontClass = {
    normal: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
    bold: 'font-bold',
  }[fontWeight];
  
  return (
    <ClickableName 
      name={name} 
      salesforceLink={salesforceLink}
      className={cn(fontClass, className)}
    />
  );
}

// Opportunity name with Salesforce link
interface OpportunityNameProps {
  name: string;
  salesforceLink?: string;
  className?: string;
}

export function OpportunityName({ name, salesforceLink, className }: OpportunityNameProps) {
  return (
    <ClickableName 
      name={name} 
      salesforceLink={salesforceLink}
      className={cn("font-medium", className)}
    />
  );
}

// Contact name with Salesforce link
interface ContactNameProps {
  name: string;
  salesforceLink?: string;
  className?: string;
}

export function ContactName({ name, salesforceLink, className }: ContactNameProps) {
  return (
    <ClickableName 
      name={name} 
      salesforceLink={salesforceLink}
      className={className}
    />
  );
}
