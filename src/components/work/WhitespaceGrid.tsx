/**
 * WhitespaceGrid — /work?tab=territory
 * Contract §2.3: expansion-quota tool.
 * Matrix: accounts × products. Tap toggles ownership.
 * Data model: public.products (user catalog) + public.account_product_ownership.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Settings2, X } from 'lucide-react';
import { fromActiveAccounts } from '@/data/accounts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type Account = { id: string; name: string };
type Product = { id: string; name: string; list_price: number | null; sort_order: number; active: boolean };
type Ownership = { account_id: string; product_id: string };

const AMBER = 'hsl(38 92% 58%)';

export function WhitespaceGrid() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editingProducts, setEditingProducts] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  const accountsQ = useQuery({
    queryKey: ['whitespace-accounts'],
    queryFn: async () => {
      const { data, error } = await fromActiveAccounts().select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const productsQ = useQuery({
    queryKey: ['whitespace-products', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products' as any)
        .select('id, name, list_price, sort_order, active')
        .order('sort_order');
      if (error) throw error;
      return ((data ?? []) as unknown) as Product[];
    },
  });

  const ownershipQ = useQuery({
    queryKey: ['whitespace-ownership', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_product_ownership' as any)
        .select('account_id, product_id')
        .eq('owned', true);
      if (error) throw error;
      return ((data ?? []) as unknown) as Ownership[];
    },
  });

  const ownedSet = useMemo(() => {
    const s = new Set<string>();
    (ownershipQ.data ?? []).forEach((o) => s.add(`${o.account_id}:${o.product_id}`));
    return s;
  }, [ownershipQ.data]);

  const toggle = useMutation({
    mutationFn: async ({ accountId, productId, currentlyOwned }: { accountId: string; productId: string; currentlyOwned: boolean }) => {
      if (!user) throw new Error('no auth');
      if (currentlyOwned) {
        const { error } = await supabase
          .from('account_product_ownership' as any)
          .delete()
          .eq('account_id', accountId)
          .eq('product_id', productId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('account_product_ownership' as any)
          .upsert(
            { user_id: user.id, account_id: accountId, product_id: productId, owned: true, noted_at: new Date().toISOString() },
            { onConflict: 'account_id,product_id' },
          );
        if (error) throw error;
      }
    },
    onMutate: async ({ accountId, productId, currentlyOwned }) => {
      await qc.cancelQueries({ queryKey: ['whitespace-ownership', user?.id] });
      const prev = qc.getQueryData<Ownership[]>(['whitespace-ownership', user?.id]);
      qc.setQueryData<Ownership[]>(['whitespace-ownership', user?.id], (old = []) =>
        currentlyOwned
          ? old.filter((o) => !(o.account_id === accountId && o.product_id === productId))
          : [...old, { account_id: accountId, product_id: productId }],
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['whitespace-ownership', user?.id], ctx.prev);
      toast.error('Failed to save');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['whitespace-ownership', user?.id] });
    },
  });

  const addProduct = useMutation({
    mutationFn: async (name: string) => {
      if (!user) throw new Error('no auth');
      const maxSort = Math.max(0, ...(productsQ.data ?? []).map((p) => p.sort_order));
      const { error } = await supabase
        .from('products' as any)
        .insert({ user_id: user.id, name: name.trim(), sort_order: maxSort + 10 } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setNewProductName('');
      qc.invalidateQueries({ queryKey: ['whitespace-products', user?.id] });
    },
    onError: (e: unknown) => toast.error((e as Error).message || 'Failed to add product'),
  });

  const updateProduct = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Product> }) => {
      const { error } = await supabase.from('products' as any).update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whitespace-products', user?.id] }),
  });

  const accounts = accountsQ.data ?? [];
  const products = (productsQ.data ?? []).filter((p) => p.active);
  const allProducts = productsQ.data ?? [];

  // Gap math
  const totalCells = accounts.length * products.length;
  const ownedCount = ownedSet.size;
  const gapCount = Math.max(0, totalCells - ownedCount);

  const hasAnyPricing = products.some((p) => typeof p.list_price === 'number' && p.list_price! > 0);
  let gapDollar = 0;
  if (hasAnyPricing) {
    accounts.forEach((a) => {
      products.forEach((p) => {
        if (!ownedSet.has(`${a.id}:${p.id}`) && typeof p.list_price === 'number') gapDollar += p.list_price;
      });
    });
  }

  const loading = accountsQ.isLoading || productsQ.isLoading || ownershipQ.isLoading;

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading whitespace…</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Add accounts in Accounts to start mapping whitespace.
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">No products yet. Add what you sell to build your whitespace map.</p>
        <Button onClick={() => setEditingProducts(true)} size="sm">
          <Plus className="h-4 w-4" /> Add products
        </Button>
        {editingProducts && <ProductEditor
          products={allProducts}
          onAdd={(n) => addProduct.mutate(n)}
          onUpdate={(id, patch) => updateProduct.mutate({ id, patch })}
          newName={newProductName}
          setNewName={setNewProductName}
          onClose={() => setEditingProducts(false)}
        />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header — gap total */}
      <div className="flex items-end justify-between px-4 pt-3 gap-3 flex-wrap">
        <div>
          <div className="font-display text-3xl font-bold tabular-nums" style={{ color: AMBER }}>
            {gapCount}
          </div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            product gaps across {accounts.length} accounts
            {hasAnyPricing && gapDollar > 0 && (
              <> · ≈${Math.round(gapDollar).toLocaleString()} list</>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditingProducts(true)}>
          <Settings2 className="h-4 w-4" /> Edit products
        </Button>
      </div>

      {ownedSet.size === 0 && (
        <div
          className="mx-4 px-3 py-2 rounded-md text-xs border"
          style={{ borderColor: `${AMBER}55`, background: `${AMBER}10` }}
        >
          Tap what each account owns — gaps become your whitespace map.
        </div>
      )}

      {/* Grid — sticky first col, horizontal scroll */}
      <div className="overflow-x-auto border-y border-border" data-swipe-exempt="true">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="sticky left-0 z-10 bg-muted/30 text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                Account
              </th>
              {products.map((p) => (
                <th
                  key={p.id}
                  className="text-center px-2 py-2 text-[11px] font-semibold text-muted-foreground min-w-[80px] max-w-[110px]"
                >
                  <div className="truncate" title={p.name}>{p.name}</div>
                  {typeof p.list_price === 'number' && p.list_price > 0 && (
                    <div className="text-[10px] text-muted-foreground/70">${p.list_price.toLocaleString()}</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-border/40 hover:bg-muted/10">
                <td
                  className="sticky left-0 z-10 bg-background px-3 py-2 cursor-pointer"
                  onClick={() => navigate(`/accounts/${a.id}`)}
                >
                  <span className="text-sm font-medium truncate block max-w-[150px]">{a.name}</span>
                </td>
                {products.map((p) => {
                  const owned = ownedSet.has(`${a.id}:${p.id}`);
                  return (
                    <td key={p.id} className="text-center px-2 py-2">
                      <button
                        onClick={() =>
                          toggle.mutate({ accountId: a.id, productId: p.id, currentlyOwned: owned })
                        }
                        aria-pressed={owned}
                        aria-label={`${a.name} — ${p.name} — ${owned ? 'owned' : 'gap'}`}
                        className={cn(
                          'mx-auto w-8 h-8 rounded-full flex items-center justify-center transition-all',
                          owned
                            ? 'text-white'
                            : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted',
                        )}
                        style={owned ? { background: AMBER } : {}}
                      >
                        {owned ? (
                          <span className="w-2.5 h-2.5 rounded-full bg-white" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 pb-4 text-[11px] text-muted-foreground">
        {ownedCount} owned · {gapCount} gap · {accounts.length}×{products.length} = {totalCells} cells
      </p>

      {editingProducts && (
        <ProductEditor
          products={allProducts}
          onAdd={(n) => addProduct.mutate(n)}
          onUpdate={(id, patch) => updateProduct.mutate({ id, patch })}
          newName={newProductName}
          setNewName={setNewProductName}
          onClose={() => setEditingProducts(false)}
        />
      )}
    </div>
  );
}

function ProductEditor({
  products, onAdd, onUpdate, onClose, newName, setNewName,
}: {
  products: Product[];
  onAdd: (name: string) => void;
  onUpdate: (id: string, patch: Partial<Product>) => void;
  onClose: () => void;
  newName: string;
  setNewName: (s: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold">Edit products</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Add product name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) onAdd(newName); }}
            />
            <Button size="sm" onClick={() => newName.trim() && onAdd(newName)} disabled={!newName.trim()}>
              Add
            </Button>
          </div>
          <div className="space-y-2">
            {products.map((p) => (
              <div key={p.id} className={cn('flex items-center gap-2 p-2 rounded-md border', p.active ? 'border-border' : 'border-border/30 opacity-50')}>
                <Input
                  value={p.name}
                  onChange={(e) => onUpdate(p.id, { name: e.target.value })}
                  className="flex-1 h-8"
                />
                <Input
                  type="number"
                  placeholder="$ list"
                  value={p.list_price ?? ''}
                  onChange={(e) => onUpdate(p.id, { list_price: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-24 h-8"
                />
                <button
                  onClick={() => onUpdate(p.id, { active: !p.active })}
                  className="text-xs text-muted-foreground hover:text-foreground px-2"
                  title={p.active ? 'Deactivate' : 'Reactivate'}
                >
                  {p.active ? 'Hide' : 'Show'}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Products are your data — rename, price, or hide freely. Hiding preserves ownership history.
          </p>
        </div>
      </div>
    </div>
  );
}
