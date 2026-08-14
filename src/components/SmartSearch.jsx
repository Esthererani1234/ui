import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import { fetchActiveProducts, readCachedProducts } from "../lib/catalogCache";
import { productImageUrl } from "../lib/productImages";
import { metalSymbol } from "../lib/pricing";
import {
  searchProducts,
  suggestSearchCorrection,
} from "../lib/productSearch";

const MINIMUM_QUERY_LENGTH = 2;
const MAXIMUM_SUGGESTIONS = 5;

export default function SmartSearch({ search, setSearch, onSubmit }) {
  const [products, setProducts] = useState(() => readCachedProducts() || []);
  const [catalogLoaded, setCatalogLoaded] = useState(() =>
    Boolean(readCachedProducts()),
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const deferredSearch = useDeferredValue(search.trim());
  const navigate = useNavigate();
  const listId = useId();

  useEffect(() => {
    if (
      !open ||
      catalogLoaded ||
      deferredSearch.length < MINIMUM_QUERY_LENGTH
    ) return undefined;
    let mounted = true;
    setLoading(true);
    fetchActiveProducts()
      .then((catalog) => {
        if (mounted) {
          setProducts(catalog);
          setCatalogLoaded(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [open, deferredSearch, catalogLoaded]);

  const suggestions = useMemo(
    () =>
      deferredSearch.length >= MINIMUM_QUERY_LENGTH
        ? searchProducts(products, deferredSearch, MAXIMUM_SUGGESTIONS)
        : [],
    [products, deferredSearch],
  );
  const correction = useMemo(
    () =>
      deferredSearch.length >= MINIMUM_QUERY_LENGTH
        ? suggestSearchCorrection(products, deferredSearch)
        : null,
    [products, deferredSearch],
  );
  const showPanel =
    open && deferredSearch.length >= MINIMUM_QUERY_LENGTH;

  useEffect(() => {
    setActiveIndex(-1);
  }, [deferredSearch]);

  const selectProduct = (product) => {
    setOpen(false);
    navigate(`/product/${product.slug}`);
  };

  const handleKeyDown = (event) => {
    if (!showPanel || !suggestions.length) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, -1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectProduct(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    setOpen(false);
    onSubmit(search);
  };

  const applyCorrection = () => {
    setSearch(correction);
    setOpen(false);
    onSubmit(correction);
  };

  return (
    <form
      className="header-search"
      onSubmit={submit}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      role="search"
    >
      <Search size={18} aria-hidden="true" />
      <input
        name="q"
        role="combobox"
        aria-label="Search products"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listId : undefined}
        aria-activedescendant={
          activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
        }
        autoComplete="off"
        placeholder="Search coins, bars, mints, weights…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      <button className="header-search-submit" type="submit">
        Search
      </button>

      {showPanel && (
        <div className="search-suggestions" id={listId} role="listbox">
          <div className="search-suggestions-title">
            <span><Sparkles size={14} /> Smart matches</span>
            <small>Based on the full catalog</small>
          </div>

          {suggestions.map((product, index) => {
            const image = product.image_url || product.image_urls?.[0];
            return (
              <Link
                id={`${listId}-option-${index}`}
                className={`search-suggestion${
                  activeIndex === index ? " active" : ""
                }`}
                key={product.id}
                to={`/product/${product.slug}`}
                role="option"
                aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => setOpen(false)}
              >
                <span className={`search-suggestion-image ${product.metal}`}>
                  {image ? (
                    <img
                      src={productImageUrl(image, 96, 72)}
                      alt=""
                      width="48"
                      height="48"
                    />
                  ) : (
                    metalSymbol(product.metal)
                  )}
                </span>
                <span className="search-suggestion-copy">
                  <b>{product.name}</b>
                  <small>{product.metal} · {product.category}</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            );
          })}

          {!loading && !suggestions.length && (
            <div className="search-suggestions-empty">
              No close product matches yet. Search the entire catalog below.
            </div>
          )}
          {loading && !products.length && (
            <div className="search-suggestions-empty">Checking the catalog…</div>
          )}

          {correction && (
            <button
              className="search-correction-option"
              type="button"
              onClick={applyCorrection}
            >
              Did you mean <b>{correction}</b>?
            </button>
          )}

          <button className="search-all-option" type="submit">
            <span>See all results for “{search.trim()}”</span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </form>
  );
}
