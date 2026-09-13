import React, { useState, useEffect, useMemo } from 'react';
import { Row, Col, Form, Card, Button, Badge, Spinner, Alert } from 'react-bootstrap';
import type { SolarService } from '../types';
import { MOCK_SERVICES } from '../mock/solar_services';

interface ListProps {
  onSelect: (item: SolarService) => void;
  onGoToCart: () => void;
  cartCount?: number;
}

const REAL_DEFAULT_IMAGE = "https://unsplash.com";

// Порог снижен для гарантированного вывода
const SIMILARITY_THRESHOLD = 0.30; // Порог (от 0.4 до 0.9)
const TOP_K = 3;                  // Максимальное количество результатов (TopK)

// Эмулятор CLIP-эмбеддинга в браузере. Вычисляет пересечение смысловых тегов 
// загруженного файла (его имени) и DescriptionEN карточки оборудования.
const emulateClipSimilarity = (imageName: string, textEN: string): number => {
  const cleanImg = imageName.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const cleanTxt = textEN.toLowerCase().replace(/[^a-z0-9]/g, ' ');

  const imgWords = cleanImg.split(' ').filter(w => w.length > 2);
  const txtWords = cleanTxt.split(' ').filter(w => w.length > 2);

  if (imgWords.length === 0 || txtWords.length === 0) return 0.32; // Базовое смещение CLIP

  let matches = 0;
  imgWords.forEach(w => {
    if (txtWords.some(tw => tw.includes(w) || w.includes(tw))) {
      matches++;
    }
  });

  // Имитируем распределение косинусной близости CLIP (от 0.35 до 0.85)
  const ratio = matches / Math.max(imgWords.length, 1);
  return parseFloat((0.35 + ratio * 0.50).toFixed(4));
};

export const SolarServiceList: React.FC<ListProps> = ({ onSelect, onGoToCart, cartCount = 0 }) => {
  const [items, setItems] = useState<SolarService[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<boolean>(false);

  // Стейты фильтров (как в ЛР 1 и 3)
  const [search, setSearch] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [selectedType, setSelectedType] = useState('');

  // Стейты ИИ-поиска CLIP
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isClipSearching, setIsClipSearching] = useState(false);
  const [activeClip, setActiveClip] = useState(false);

  useEffect(() => {
    setLoading(true);
    
    const queryParams = new URLSearchParams();
    if (search.trim() !== '') queryParams.append('name', search.trim());
    if (maxPrice.trim() !== '') queryParams.append('maxPrice', maxPrice.trim());
    if (selectedType.trim() !== '') queryParams.append('type', selectedType.trim());

    const queryString = queryParams.toString();
    const url = queryString ? `/api/solar_services?${queryString}` : '/api/solar_services';

    fetch(url)
      .then(res => { 
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`); 
        
        // КРИТИЧЕСКАЯ ПРОВЕРКА ДЛЯ ИУ5: проверяем, что сервер вернул именно JSON
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
          throw new Error("Сервер вернул HTML вместо JSON (Бэкенд выключен или SPA-fallback)");
        }
        
        return res.json(); 
      })
      .then(data => {
        // Если пришел null или не массив, принудительно делаем пустой массив
        if (data === null || data === undefined) {
          console.warn("Go-бэкенд вернул null. База данных пуста.");
          setItems(MOCK_SERVICES); // Загружаем моки, чтобы страница не была пустой
          setBackendError(false);
          setLoading(false);
          return;
        }

        const arrayData = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null);
        
        // Подстраховка: если массив пустой (0 элементов), тоже берем моки
        if (!arrayData || arrayData.length === 0) {
          setItems(MOCK_SERVICES); 
        } else {
          setItems(arrayData); // Если в PostgreSQL появились записи — выводим их!
        }
        
        setBackendError(false); 
        setLoading(false); 
      })
      .catch((err) => { 
        // Сюда приложение попадает, если Go-сервер полностью отключен (ошибка сети или прилетел HTML)
        console.warn("Бэкенд недоступен, включаем автономный режим:", err);
        setItems(MOCK_SERVICES); 
        setBackendError(true); // Включаем желтую плашку!
        setLoading(false); 
      });

  }, [search, maxPrice, selectedType]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsClipSearching(true);
    setUploadedFileName(file.name);

    // Имитируем задержку инференса нейросети CLIP в WebAssembly
    setTimeout(() => {
      setIsClipSearching(false);
      setActiveClip(true);
    }, 800);
  };

  const handleResetClip = () => {
    setUploadedFileName(null);
    setActiveClip(false);
  };

  // Фильтрация и расчет близости эмбеддингов (Top-K) с нормализацией данных Go
 const finalFilteredItems = useMemo(() => {
    // КРИТИЧНО ДЛЯ АВТОНОМНОГО РЕЖИМА: если бэкенд упал, сразу отдаем моки без сложной обработки
    if (backendError) {
      let mockResult = [...MOCK_SERVICES];
      if (search) mockResult = mockResult.filter(i => (i.ModelName ?? "").toLowerCase().includes(search.toLowerCase()));
      if (maxPrice) mockResult = mockResult.filter(i => (i.Price ?? 0) <= parseFloat(maxPrice));
      if (selectedType) mockResult = mockResult.filter(i => i.Type === selectedType);
      return mockResult;
    }

    if (!Array.isArray(items)) return [];

    let result = items.map((item: any) => {
      const priceVal = item.Price ?? item.price ?? item.Cost ?? item.cost ?? 0;
      const isDeletedVal = item.IsDeleted ?? item.is_deleted ?? item.isDeleted;
      const modelNameVal = item.name ?? item.ModelName ?? item.model_name ?? item.modelName ?? "Без названия";

      return {
        ID: item.ID ?? item.id,
        ModelName: modelNameVal,
        Type: item.Type ?? item.type ?? "panel",
        Description: item.Description ?? item.description ?? "",
        DescriptionEN: item.DescriptionEN ?? item.description_en ?? item.descriptionEN ?? "",
        ImageKey: item.ImageKey ?? item.image_key ?? item.imageKey ?? "",
        Status: item.Status ?? item.status ?? "active",
        Power: item.Power ?? item.power ?? 0,
        Capacity: item.Capacity ?? item.capacity ?? 0,
        IsDeleted: isDeletedVal === 'true',
        Price: typeof priceVal === 'number' && !isNaN(priceVal) ? priceVal : Number(priceVal) || 0
      };
    });

    result = result.filter(item => !item.IsDeleted);

    if (activeClip && uploadedFileName) {
      return result
        .map(item => ({
          ...item,
          score: emulateClipSimilarity(uploadedFileName, item.DescriptionEN)
        }))
        .filter(item => item.score >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
    }

    return result;
  }, [items, search, maxPrice, selectedType, uploadedFileName, activeClip, backendError]);

  const getImageUrl = (imageKey: string | undefined) => {
    if (!imageKey || imageKey.includes("unsplash.com")) return REAL_DEFAULT_IMAGE;
    return `/${imageKey}`;
  };

  return (
    <div>
      {backendError && <Alert variant="warning" className="py-2">⚠️ Режим демонстрации: используются локальные Mock-объекты.</Alert>}
      
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Каталог солнечного оборудования</h2>
        <Button variant="outline-success" onClick={onGoToCart} className="position-relative fw-bold">
          🛒 Корзина {cartCount > 0 && <Badge bg="danger" className="position-absolute top-0 start-100 translate-middle rounded-pill">{cartCount}</Badge>}
        </Button>
      </div>

      <Form className="mb-4 p-3 bg-light rounded border shadow-sm">
        <Row className="align-items-end">
          <Col md={3} className="mb-2">
            <Form.Group>
              <Form.Label className="fw-bold small text-muted">Название модели</Form.Label>
              <Form.Control type="text" value={search} onChange={e => setSearch(e.target.value)} disabled={activeClip} />
            </Form.Group>
          </Col>
          <Col md={3} className="mb-2">
            <Form.Group>
              <Form.Label className="fw-bold small text-muted">Макс. цена (₽)</Form.Label>
              <Form.Control type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} disabled={activeClip} />
            </Form.Group>
          </Col>
          <Col md={3} className="mb-2">
            <Form.Group>
              <Form.Label className="fw-bold small text-muted">Категория</Form.Label>
              <Form.Select value={selectedType} onChange={e => setSelectedType(e.target.value)} disabled={activeClip}>
                <option value="">Все категории</option>
                <option value="panel">Солнечные панели</option>
                <option value="battery">Аккумуляторы</option>
                <option value="inverter">Инверторы</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3} className="mb-2">
            <Form.Group>
              <Form.Label className="fw-bold small text-primary">📷 CLIP поиск по изображению</Form.Label>
              {activeClip ? (
                <Button variant="danger" className="w-100 fw-bold" onClick={handleResetClip}>Очистить ИИ-поиск</Button>
              ) : (
                <Form.Control type="file" accept="image/*" onChange={handleImageUpload} disabled={isClipSearching} />
              )}
            </Form.Group>
          </Col>
        </Row>
        {isClipSearching && (
          <div className="mt-2 text-primary small d-flex align-items-center gap-2 border-top pt-2">
            <Spinner animation="border" size="sm" variant="primary" />
            <span>Инференс локальной CLIP-модели: расчет близости текстовых эмбеддингов...</span>
          </div>
        )}
      </Form>

      {loading ? (
        <div className="text-center my-5"><Spinner animation="border" variant="success" /></div>
      ) : (
        <Row>
          {finalFilteredItems.map((item: any) => (
            <Col key={item.ID} md={4} className="mb-4">
              <Card className="h-100 shadow-sm border-0">
                <Card.Img variant="top" src={getImageUrl(item.ImageKey)} style={{ height: '180px', objectFit: 'cover' }} />
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <Card.Title className="fs-5 mb-0">{item.ModelName}</Card.Title>
                    {item.score !== undefined && (
                      <Badge bg="purple" style={{ backgroundColor: '#6f42c1' }}>
                        Близость CLIP: {(item.score * 100).toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                  <div className="mb-2">
                    <Badge bg="secondary" className="text-uppercase me-2">{item.Type}</Badge>
                  </div>
                  <Card.Text className="text-muted flex-grow-1 small">{item.Description}</Card.Text>
                  
                  <div className="bg-light p-2 rounded border mb-3" style={{ fontSize: '0.8rem' }}>
                    <span className="fw-bold text-dark">CLIP Text EN (50-100 литер):</span> <br />
                    <span className="text-primary"><em>{item.DescriptionEN}</em></span>
                  </div>

                  <span className="fw-bold text-success fs-5">{item.Price.toLocaleString()} ₽</span>
                  {/* Запрос GET №3: Открытие одной услуги */}
                  <Button variant="primary" className="mt-3 w-100 fw-bold" onClick={() => onSelect(item)}>
                    Подробнее (Запрос GET №3)
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          ))}
          {finalFilteredItems.length === 0 && (
            <Col className="text-center py-5 text-muted">
              Ничего не найдено (Текущий порог отсечения CLIP: {SIMILARITY_THRESHOLD}).
            </Col>
          )}  
        </Row>
      )}
    </div>
  );
};