<?php

namespace Drupal\valet\Plugin;

/**
 * A collection of Valet items.
 */
class ValetItems implements \IteratorAggregate, \ArrayAccess, \Countable {

  /**
   * The array.
   *
   * @var \Drupal\valet\Plugin\ValetItem[]
   */
  protected $data = [];

  /**
   * Array object constructor.
   *
   * @param mixed $data
   *   An string, array of arrays or ValetItem[].
   */
  public function __construct($data = []) {
    $this->setItems($data);
  }

  /**
   * Set the items.
   *
   * @param mixed $data
   *   An array of arrays or ValetItem[].
   *
   * @return \Drupal\valet\Plugin\ValetItem[]
   *   An array of items.
   */
  public function setItems($data) {
    foreach ($data as $offset => $value) {
      $this->set($offset, $value);
    }
    return $this->data;
  }

  /**
   * Append an item.
   */
  public function appendItem(ValetItem $item) {
    $offset = count($this->data);
    $this->set($offset, $item);
  }

  /**
   * Returns whether the requested key exists.
   *
   * @param mixed $key
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function __isset($key) {
    return $this->offsetExists($key);
  }

  /**
   * Sets the value at the specified key to value.
   *
   * @param mixed $key
   *   A key.
   * @param mixed $value
   *   A value.
   */
  public function __set($key, $value) {
    $this->offsetSet($key, $value);
  }

  /**
   * Unsets the value at the specified key.
   *
   * @param mixed $key
   *   A key.
   */
  public function __unset($key) {
    $this->offsetUnset($key);
  }

  /**
   * Returns the value at the specified key by reference.
   *
   * @param mixed $key
   *   A key.
   *
   * @return mixed
   *   The stored value.
   */
  public function &__get($key) {
    $ret =& $this->offsetGet($key);
    return $ret;
  }

  /**
   * Returns the collection.
   *
   * @return \Drupal\valet\Plugin\ValetItem[]
   *   The array.
   */
  public function items() {
    return $this->data;
  }

  /**
   * Returns the collection as an array.
   *
   * @return array
   *   The array.
   */
  public function toArray() {
    $data = [];
    foreach ($this->data as $key => $item) {
      $data[$key] = $item->toArray();
    }
    return $data;
  }

  /**
   * Get the number of public properties in the ArrayObject.
   *
   * @return int
   *   The count.
   */
  public function count(): int {
    return count($this->data);
  }

  /**
   * Get the first item.
   *
   * @return int
   *   The count.
   */
  public function first() {
    if ($this->count()) {
      return $this->offsetGet(key($this->data));
    }
    return NULL;
  }

  /**
   * Get the last item.
   *
   * @return int
   *   The count.
   */
  public function last() {
    if ($this->count()) {
      $keys = array_keys($this->data);
      return $this->offsetGet(end($keys));
    }
    return NULL;
  }

  /**
   * Check ArrayObject for results.
   *
   * @return int
   *   The count.
   */
  public function hasItems() {
    return !empty($this->count());
  }

  /**
   * Check ArrayObject for results.
   *
   * @return array
   *   The slice.
   */
  public function slice($offset, $length, $preserve_keys = FALSE) {
    $this->data = array_slice($this->data, $offset, $length, $preserve_keys);
    return $this->data;
  }

  /**
   * Returns whether the requested key is empty.
   *
   * @param mixed $offset
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function empty($offset) {
    return empty($this->offsetGet($offset));
  }

  /**
   * Returns whether the requested key exists.
   *
   * @param mixed $offset
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function has($offset) {
    return $this->offsetExists($offset);
  }

  /**
   * Returns the value at the specified key.
   *
   * @param mixed $offset
   *   A key.
   *
   * @return mixed
   *   The value.
   */
  public function &get($offset) {
    return $this->offsetGet($offset);
  }

  /**
   * Sets the value at the specified key to value.
   *
   * @param mixed $offset
   *   A key.
   * @param mixed $value
   *   A value.
   */
  public function set($offset, $value) {
    $this->offsetSet($offset, $value);
  }

  /**
   * Unsets the value at the specified key.
   *
   * @param mixed $offset
   *   A key.
   */
  public function unset($offset) {
    $this->offsetUnset($offset);
  }

  /**
   * Returns whether the requested key exists.
   *
   * @param mixed $offset
   *   A key.
   *
   * @return bool
   *   TRUE or FALSE
   */
  public function offsetExists($offset): bool {
    return isset($this->data[$offset]);
  }

  /**
   * Returns the value at the specified key.
   *
   * @param mixed $offset
   *   A key.
   *
   * @return mixed
   *   The value.
   */
  public function &offsetGet($offset): mixed {
    $value = NULL;
    if (!$this->offsetExists($offset)) {
      return $value;
    }
    $value = &$this->data[$offset];
    return $value;
  }

  /**
   * Sets the value at the specified key to value.
   *
   * @param mixed $offset
   *   A key.
   * @param mixed $value
   *   A value.
   */
  public function offsetSet($offset, $value): void {
    if (!$value instanceof ValetItem) {
      $value = new ValetItem($value);
    }
    $this->data[$offset] = $value;
  }

  /**
   * Unsets the value at the specified key.
   *
   * @param mixed $offset
   *   A key.
   */
  public function offsetUnset($offset): void {
    unset($this->data[$offset]);
  }

  /**
   * Returns an iterator for entities.
   *
   * @return \ArrayIterator
   *   An \ArrayIterator instance
   */
  public function getIterator(): \ArrayIterator {
    return new \ArrayIterator($this->data);
  }

}
