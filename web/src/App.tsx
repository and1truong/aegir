import { ProductProvider } from './product/ProductContext';
import { ProductApp } from './product/ProductApp';
import { InvestigationProvider } from './investigation/InvestigationContext';

export default function App() {
  return (
    <ProductProvider>
      <InvestigationProvider>
        <ProductApp />
      </InvestigationProvider>
    </ProductProvider>
  );
}
