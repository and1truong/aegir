import { ProductProvider } from './product/ProductContext';
import { ProductApp } from './product/ProductApp';

export default function App() {
  return (
    <ProductProvider>
      <ProductApp />
    </ProductProvider>
  );
}
